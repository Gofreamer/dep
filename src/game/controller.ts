import type { AiLevel, ChoiceRequest, Command, GameEvent, MatchState, PlayerId } from '../engine/types';
import { DEFAULT_CONFIG } from '../engine/types';
import { MatchEngine } from '../engine/engine';
import { aiNextCommand, aiSmartChoice } from '../engine/ai/ai';
import { metaStore } from '../persistence/store';
import type { MatchRecord } from '../persistence/types';
import { registry } from '../engine/registry';
import { charDef, charactersInPlay, player } from '../engine/queries';
import { expandDeck } from '../data/deckUtils';
import { cuesFromEvents } from './cues';
import { JET_STARTER_DECKS } from '../data/jet/starterDecks';
import { JET_TUTORIAL_DECKS } from '../data/jet/tutorialDecks';

// ---------------------------------------------------------------------------
// FX cues — visual representations of already-resolved game events
// ---------------------------------------------------------------------------

export interface Cue {
  id: number;
  kind: 'damage' | 'heal' | 'ko' | 'shake' | 'attack' | 'draw' | 'upgrade' | 'status' | 'vp' | 'toast' | 'coin';
  uid?: string;
  text?: string;
  player?: PlayerId;
  big?: boolean;
}

export interface MatchConfig {
  playerDeckId: string;
  opponentDeckId: string;
  difficulty: AiLevel;
  seed?: number;
  tutorial?: boolean;
  victoryTarget?: number;
}

export type MatchOutcome = { winner: PlayerId | 'draw'; reason: string; turns: number } | null;

const SPEED_MS = { slow: 1150, normal: 750, fast: 380 };

/**
 * Bridges the authoritative engine and the UI. Sends commands, schedules AI
 * turns with delays, translates events into visual cues and records results.
 */
export class MatchController {
  engine: MatchEngine;
  human: PlayerId = 0;
  outcome: MatchOutcome = null;
  tutorialStep = 0;
  tutorialActive: boolean;
  onCue: (c: Cue) => void = () => {};
  onInvalid: (msg: string) => void = () => {};
  onSync: () => void = () => {};
  private lastSeq = 0;
  private cueId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(public cfg: MatchConfig) {
    this.tutorialActive = !!cfg.tutorial;
    const playerDeck = this.deckDefIds(cfg.playerDeckId);
    const oppDeck = this.deckDefIds(cfg.opponentDeckId);
    const speed = metaStore.state.settings.speed;
    void speed;
    this.engine = new MatchEngine({
      seed: cfg.seed ?? Math.floor(Math.random() * 1e9),
      config: {
        ...DEFAULT_CONFIG,
        victory: { ...DEFAULT_CONFIG.victory, targetPoints: cfg.victoryTarget ?? DEFAULT_CONFIG.victory.targetPoints }
      },
      players: [
        { name: metaStore.state.settings.player1Name || 'Você', deckId: cfg.playerDeckId, isAI: false, aiLevel: 'normal', deck: playerDeck },
        { name: cfg.tutorial ? 'Instrutor' : 'Oponente', deckId: cfg.opponentDeckId, isAI: true, aiLevel: cfg.tutorial ? 'easy' : cfg.difficulty, deck: oppDeck }
      ]
    });
    this.lastSeq = this.engine.state.eventSeq;
    if (this.tutorialActive) this.rigTutorialHand();
  }

  private deckDefIds(deckId: string) {
    const saved = metaStore.getDeck(deckId);
    if (saved) {
      const cards: string[] = [];
      for (const [id, n] of Object.entries(saved.cards)) for (let i = 0; i < n; i++) cards.push(id);
      return cards.map((id) => registry.card(id));
    }
    const starter = [...JET_TUTORIAL_DECKS, ...JET_STARTER_DECKS].find((d) => d.id === deckId);
    if (starter) return expandDeck(starter).map((id) => registry.card(id));
    return expandDeck(JET_STARTER_DECKS[0]).map((id) => registry.card(id));
  }

  /** Tutorial: deterministic opening hand so steps are teachable. */
  private rigTutorialHand(): void {
    const st = this.engine.state;
    const me = player(st, 0);
    me.hand = [];
    me.deck = me.deck.filter((c) => true);
    const want = ['agent-jenny-base', 'agent-xixim-base', 'agent-ran-yuki-base', 'jres-energia', 'jres-energia', 'jact-leitura', 'jeq-manopla'];
    for (const defId of want) {
      const inDeck = me.deck.find((c) => c.defId === defId);
      if (inDeck) me.hand.push(inDeck);
    }
    me.deck = me.deck.filter((c) => !me.hand.includes(c));
    st.triggerQueue = [];
  }

  // -------------------------------------------------------------------------
  // Flow
  // -------------------------------------------------------------------------

  start(onSync: () => void): void {
    this.onSync = onSync;
    this.processEvents();
    onSync();
    this.scheduleAiTick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** UI → engine entry point. Applies tutorial gating. Returns success. */
  send(cmd: Command): boolean {
    if (this.outcome || this.stopped) return false;
    if (this.engine.state.phase === 'setup' && cmd.player !== undefined && this.engine.state.players[cmd.player].isAI && cmd.player !== 1) return false;
    if (this.tutorialActive && !this.tutorialAllows(cmd)) {
      this.onInvalid(this.tutorialBlockedText());
      return false;
    }
    const r = this.engine.dispatch(cmd);
    if (!r.ok) {
      if (r.error) this.onInvalid(r.error);
      return false;
    }
    this.processEvents();
    this.onSync();
    if (this.tutorialActive) this.tutorialAdvance(cmd);
    // human may need to answer a choice (targets etc.)
    if (this.engine.getPending()) return true;
    this.checkOutcome();
    if (!this.outcome) this.scheduleAiTick();
    return true;
  }

  /** Answers a pending human choice. */
  resolveChoice(selected: string[]): boolean {
    const pend = this.engine.getPending();
    if (!pend) return false;
    return this.send({ type: 'RESOLVE_CHOICE', player: pend.player, selected });
  }

  private scheduleAiTick(): void {
    if (this.stopped || this.outcome) return;
    const st = this.engine.state;
    if (st.phase === 'setup') {
      // AI setup with small delays
      this.timer = setTimeout(() => this.aiTick(), 550);
      return;
    }
    if (!st.players[st.activePlayer].isAI) return; // waiting on human
    const speed = SPEED_MS[metaStore.state.settings.speed] ?? 750;
    this.timer = setTimeout(() => this.aiTick(), speed);
  }

  private aiTick(): void {
    if (this.stopped || this.outcome) return;
    const st = this.engine.state;
    if (st.phase === 'gameOver') { this.checkOutcome(); return; }
    if (st.phase === 'setup') {
      // No setup o activePlayer ainda não alterna: quem prepara é cada jogador.
      // O controller dirige SEMPRE o setup da IA aqui — sem isso a partida
      // trava na preparação quando o humano finaliza primeiro.
      const aiPlayer = st.players.find((p) => p.isAI && !p.setupDone);
      if (!aiPlayer) { this.checkOutcome(); return; }
      const cmd = aiNextCommand(this.engine, aiPlayer.index);
      const r = this.engine.dispatch(cmd);
      if (!r.ok) {
        // SEM fallback silencioso: comando ilegal da IA é um bug e deve ficar
        // visível (item 31) — nunca mascarado com END_TURN.
        this.onInvalid(`ia (setup) ilegal: ${cmd.type} — ${r.error ?? '?'}`);
        this.processEvents();
        this.onSync();
        return; // para o tick: partida visivelmente parada, bug denunciado
      }
      this.processEvents();
      this.onSync();
      this.scheduleAiTick();
      return;
    }
    const ai = st.players[st.activePlayer];
    if (!ai.isAI) return;
    const cmd = aiNextCommand(this.engine, ai.index);
    const r = this.engine.dispatch(cmd);
    if (!r.ok) {
      // SEM fallback silencioso (item 31): a bateria de partidas garante que a
      // IA só emite comandos legais; se um dia falhar, o bug fica visível.
      this.onInvalid(`ia ilegal: ${cmd.type} — ${r.error ?? '?'}`);
      this.processEvents();
      this.onSync();
      return;
    }
    this.processEvents();
    this.onSync();
    this.checkOutcome();
    if (!this.outcome) this.scheduleAiTick();
  }

  /** Public: reavalia o fim de partida (chamado após resoluções manuais). */
  checkOutcome(): void {
    const st = this.engine.state;
    if (st.phase !== 'gameOver' || this.outcome) return;
    this.outcome = { winner: st.winner ?? 'draw', reason: st.endReason ?? '', turns: st.turn };
    if (!this.tutorialActive) {
      const rec: MatchRecord = {
        id: `m-${Date.now()}`,
        date: Date.now(),
        playerDeckId: this.cfg.playerDeckId,
        opponentDeckId: this.cfg.opponentDeckId,
        result: st.winner === this.human ? 'win' : 'loss',
        reason: st.endReason ?? '',
        turns: st.turn,
        victoryPoints: [st.players[0].victoryPoints, st.players[1].victoryPoints]
      };
      metaStore.recordMatch(rec);
    } else if (st.winner === 0) {
      metaStore.state.settings.tutorialDone = true;
      metaStore.save();
    }
  }

  // -------------------------------------------------------------------------
  // Events → cues
  // -------------------------------------------------------------------------

  private processEvents(): void {
    const evs: GameEvent[] = this.engine.eventsSince(this.lastSeq);
    this.lastSeq = this.engine.state.eventSeq;
    // Tradução evento→cue compartilhada com o multiplayer (src/game/cues.ts).
    for (const seed of cuesFromEvents(evs)) this.cue(seed);
  }

  private cue(c: Omit<Cue, 'id'>): void {
    this.onCue({ ...c, id: this.cueId++ });
  }

  // -------------------------------------------------------------------------
  // Tutorial script
  // -------------------------------------------------------------------------

  tutorialAllows(cmd: Command): boolean {
    if (!this.tutorialActive) return true;
    // Durante a escolha pendente do jogador, sempre permitir resolver
    if (cmd.type === 'RESOLVE_CHOICE' || cmd.type === 'CONCEDE') return true;
    const step = TUTORIAL_STEPS[this.tutorialStep];
    if (!step) return true;
    if (step.allow && !step.allow.includes(cmd.type)) return false;
    return true;
  }

  tutorialBlockedText(): string {
    const step = TUTORIAL_STEPS[this.tutorialStep];
    return step?.blocked ?? 'Siga a instrução do tutorial para continuar.';
  }

  private tutorialAdvance(cmd: Command): void {
    const step = TUTORIAL_STEPS[this.tutorialStep];
    if (!step) return;
    if (step.trigger && step.trigger(cmd)) this.tutorialStep = Math.min(this.tutorialStep + 1, TUTORIAL_STEPS.length);
  }
}

export interface TutorialStep {
  title: string;
  text: string;
  allow?: Command['type'][];
  trigger?: (cmd: Command) => boolean;
  blocked?: string;
}

/** Roteiro do tutorial — curto, guiado por ações reais (roster JET). */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Escolha seu Ativo',
    text: 'Toque em Jenny e confirme como sua Agente ativa.',
    allow: ['SETUP_SET_ACTIVE'],
    trigger: (c) => c.type === 'SETUP_SET_ACTIVE',
    blocked: 'Primeiro escolha sua Agente ativa.'
  },
  {
    title: 'Monte a Reserva',
    text: 'Toque em Xixim para colocá-lo na Reserva (banco).',
    allow: ['SETUP_BENCH'],
    trigger: (c) => c.type === 'SETUP_BENCH',
    blocked: 'Coloque Xixim na Reserva.'
  },
  {
    title: 'Pronto!',
    text: 'Toque em “Pronto” para começar a batalha.',
    allow: ['SETUP_DONE'],
    trigger: (c) => c.type === 'SETUP_DONE',
    blocked: 'Toque em Pronto para iniciar.'
  },
  {
    title: 'Conecte uma Energia',
    text: 'Energias pagam ataques e habilidades. Toque na Energia JET e depois na Jenny.',
    allow: ['ATTACH_RESOURCE'],
    trigger: (c) => c.type === 'ATTACH_RESOURCE',
    blocked: 'Conecte a Energia JET à Jenny.'
  },
  {
    title: 'Jogue uma Técnica',
    text: 'Toque em Leitura de Combate: compre 2 cartas.',
    allow: ['PLAY_ACTION'],
    trigger: (c) => c.type === 'PLAY_ACTION',
    blocked: 'Use a Técnica Leitura de Combate.'
  },
  {
    title: 'Equipe um Equipamento',
    text: 'Toque na Manopla Reforçada para equipar sua Agente ativa (+10 de dano).',
    allow: ['PLAY_EQUIPMENT', 'ATTACH_RESOURCE', 'PLAY_ACTION'],
    trigger: (c) => c.type === 'PLAY_EQUIPMENT',
    blocked: 'Equipe a Manopla Reforçada na sua Agente ativa.'
  },
  {
    title: 'Encerre o Turno',
    text: 'Sem mais ações? Toque em Encerrar Turno.',
    allow: ['END_TURN', 'ATTACH_RESOURCE', 'PLAY_ACTION', 'PLAY_EQUIPMENT'],
    trigger: (c) => c.type === 'END_TURN',
    blocked: 'Toque em Encerrar Turno.'
  },
  {
    title: 'Ataque!',
    text: 'No seu turno, toque no ataque da sua Agente ativa. Derrote o inimigo para ganhar Pontos de Vitória!',
    allow: ['ATTACK', 'ATTACH_RESOURCE', 'PLAY_ACTION', 'PLAY_EQUIPMENT', 'END_TURN'],
    trigger: (c) => c.type === 'ATTACK',
    blocked: 'Ataque com a sua Agente ativa!'
  },
  {
    title: 'Vitória!',
    text: 'Você derrotou o inimigo e ganhou Pontos de Vitória. Alcance o alvo para vencer!',
    allow: ['ATTACK', 'ATTACH_RESOURCE', 'PLAY_ACTION', 'PLAY_EQUIPMENT', 'END_TURN'],
    trigger: () => false
  }
];
