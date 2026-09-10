import type { AiLevel, ChoiceRequest, Command, GameEvent, MatchState, PlayerId } from '../engine/types';
import { DEFAULT_CONFIG } from '../engine/types';
import { MatchEngine } from '../engine/engine';
import { aiNextCommand, aiSmartChoice } from '../engine/ai/ai';
import { metaStore } from '../persistence/store';
import type { MatchRecord } from '../persistence/types';
import { registry } from '../engine/registry';
import { charDef, charactersInPlay, player } from '../engine/queries';
import { expandDeck, STARTER_DECKS, TUTORIAL_DECKS } from '../data/fixtures/nexo/decks';

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
    const starter = [...STARTER_DECKS, ...TUTORIAL_DECKS].find((d) => d.id === deckId);
    if (starter) return expandDeck(starter).map((id) => registry.card(id));
    return expandDeck(STARTER_DECKS[0]).map((id) => registry.card(id));
  }

  /** Tutorial: deterministic opening hand so steps are teachable. */
  private rigTutorialHand(): void {
    const st = this.engine.state;
    const me = player(st, 0);
    me.hand = [];
    me.deck = me.deck.filter((c) => true);
    const want = ['char-cindro', 'char-chispito', 'char-ignarok', 'res-solar', 'res-solar', 'res-volt', 'act-golpe'];
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
    if (this.outcome) return false;
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
    const ai = st.players[st.activePlayer];
    if (!ai.isAI) return;
    const cmd = aiNextCommand(this.engine, ai.index);
    const r = this.engine.dispatch(cmd);
    if (!r.ok && cmd.type !== 'END_TURN') {
      this.engine.dispatch({ type: 'END_TURN', player: ai.index });
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
    for (const ev of evs) {
      const p = ev.payload as Record<string, any>;
      switch (ev.type) {
        case 'DAMAGE_DEALT':
          if (!p.preview && p.uid && p.amount > 0) this.cue({ kind: 'damage', uid: p.uid, text: `-${p.amount}`, big: p.amount >= 50 });
          break;
        case 'HEALED':
          if (p.uid && p.amount > 0) this.cue({ kind: 'heal', uid: p.uid, text: `+${p.amount}` });
          break;
        case 'CHARACTER_DEFEATED':
          this.cue({ kind: 'ko', uid: p.uid, text: 'DERROTADO' });
          this.cue({ kind: 'shake' });
          break;
        case 'ATTACK_USED':
          this.cue({ kind: 'attack', uid: p.uid });
          break;
        case 'CHARACTER_UPGRADED':
          this.cue({ kind: 'upgrade', uid: p.uid, text: 'EVOLUIU!' });
          break;
        case 'STATUS_APPLIED':
          this.cue({ kind: 'status', uid: p.uid, text: String(p.status ?? '') });
          break;
        case 'VICTORY_POINTS_CHANGED':
          this.cue({ kind: 'vp', player: ev.player ?? undefined, text: `+${p.amount} PV` });
          break;
        case 'COIN_FLIPPED':
          this.cue({ kind: 'coin', text: p.success ? '✦ Cara!' : '✧ Coroa' });
          break;
        case 'MATCH_ENDED':
          this.cue({ kind: 'shake', big: true });
          break;
        default:
          break;
      }
    }
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

/** Roteiro do tutorial — curto, guiado por ações reais. */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Escolha seu Ativo',
    text: 'Toque em Cindro e confirme como seu personagem ativo.',
    allow: ['SETUP_SET_ACTIVE'],
    trigger: (c) => c.type === 'SETUP_SET_ACTIVE',
    blocked: 'Primeiro escolha seu personagem ativo.'
  },
  {
    title: 'Monte a Reserva',
    text: 'Toque em Chispito para colocá-lo na Reserva (banco).',
    allow: ['SETUP_BENCH'],
    trigger: (c) => c.type === 'SETUP_BENCH',
    blocked: 'Coloque Chispito na Reserva.'
  },
  {
    title: 'Pronto!',
    text: 'Toque em “Pronto” para começar a batalha.',
    allow: ['SETUP_DONE'],
    trigger: (c) => c.type === 'SETUP_DONE',
    blocked: 'Toque em Pronto para iniciar.'
  },
  {
    title: 'Conecte um Recurso',
    text: 'Recursos pagam ataques. Toque na Essência Solar e depois no Cindro.',
    allow: ['ATTACH_RESOURCE'],
    trigger: (c) => c.type === 'ATTACH_RESOURCE',
    blocked: 'Conecte a Essência Solar ao Cindro.'
  },
  {
    title: 'Jogue uma Ação',
    text: 'Toque em Golpe Tático: 30 de dano no ativo inimigo.',
    allow: ['PLAY_ACTION'],
    trigger: (c) => c.type === 'PLAY_ACTION',
    blocked: 'Use a carta de ação Golpe Tático.'
  },
  {
    title: 'Evolua!',
    text: 'Toque em Ignarok e depois no Cindro para evoluí-lo.',
    allow: ['UPGRADE', 'ATTACH_RESOURCE', 'PLAY_ACTION'],
    trigger: (c) => c.type === 'UPGRADE',
    blocked: 'Evolua o Cindro com a carta Ignarok.'
  },
  {
    title: 'Encerre o Turno',
    text: 'Sem mais ações? Toque em Encerrar Turno.',
    allow: ['END_TURN', 'ATTACH_RESOURCE', 'PLAY_ACTION', 'UPGRADE'],
    trigger: (c) => c.type === 'END_TURN',
    blocked: 'Toque em Encerrar Turno.'
  },
  {
    title: 'Ataque!',
    text: 'No seu turno, toque no ataque do seu ativo. Derrote o inimigo para ganhar PV!',
    allow: ['ATTACK', 'ATTACH_RESOURCE', 'PLAY_ACTION', 'END_TURN'],
    trigger: (c) => c.type === 'ATTACK',
    blocked: 'Ataque com o seu personagem ativo!'
  },
  {
    title: 'Vitória!',
    text: 'Você derrotou o inimigo e ganhou Pontos de Vitória. Alcance o alvo para vencer!',
    allow: ['ATTACK', 'ATTACH_RESOURCE', 'PLAY_ACTION', 'END_TURN'],
    trigger: () => false
  }
];
