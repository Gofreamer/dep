/**
 * REPLAY / VERIFICAÇÃO SERVER-SIDE — o servidor determina o resultado.
 *
 * O cliente NUNCA envia "eu venci". Ele envia apenas:
 *   - o baralho usado (validado server-side contra o catálogo JET);
 *   - a seed e o oponente (bot) escolhidos no matchmaking;
 *   - a sequência de comandos DO HUMANO (incl. escolhas mid-effect).
 *
 * O servidor reconstrói a partida no MatchEngine real, gera os comandos do BOT
 * ele mesmo (IA determinística) e valida cada comando do humano. Se qualquer
 * comando for ilegal, ou a sequência não terminar a partida, a submissão é
 * REJEITADA (resultado não confiável). O vencedor é lido do estado final do
 * engine — nunca do payload do cliente.
 */

import { MatchEngine } from '../engine/engine';
import { aiNextCommand, aiSmartChoice } from '../engine/ai/ai';
import type { AiProfile } from '../engine/ai/profile';
import type { CardDef, Command, PlayerId } from '../engine/types';
import { registry } from '../engine/registry';

export interface ReplayOutcome {
  winner: PlayerId;
  endReason: string;
  turns: number;
  commandsReplayed: number;
}

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

/** Comando esperado na vez do humano vs. do bot. */
function actorFor(engine: MatchEngine): PlayerId {
  if (engine.state.phase === 'setup') {
    // Setup é sequencial: jogador 0 completa primeiro, depois o 1.
    for (const p of [0, 1] as const) {
      if (!engine.state.players[p].setupDone) return p;
    }
  }
  return engine.state.activePlayer as PlayerId;
}

export interface ReplayInput {
  seed: number;
  /** Baralho do humano (60 cartas, ids JET válidos — já validados pelo caller). */
  humanDeck: CardDef[];
  /** Baralho do bot (arquétipo). */
  botDeck: CardDef[];
  botProfile: AiProfile;
  /** Assento do humano (0 ou 1). */
  humanSeat: PlayerId;
  /** Sequência de comandos do humano, na ordem em que foram jogados. */
  commands: Command[];
  maxCommands?: number;
}

/**
 * Reconstrói e valida a partida. Lança `ReplayError` em qualquer divergência
 * (comando ilegal, comando do jogador errado, sequência incompleta).
 */
export function replayMatch(input: ReplayInput): ReplayOutcome {
  const humanSeat = input.humanSeat;
  const botSeat = (humanSeat === 0 ? 1 : 0) as PlayerId;
  const queue = [...input.commands];
  const maxCommands = input.maxCommands ?? 4000;

  const engine = new MatchEngine({
    seed: input.seed,
    players: [
      { name: humanSeat === 0 ? 'human' : input.botProfile.label, deckId: humanSeat === 0 ? 'human' : 'bot', isAI: humanSeat !== 0, aiLevel: humanSeat === 0 ? 'normal' : 'hard', deck: humanSeat === 0 ? input.humanDeck : input.botDeck },
      { name: humanSeat === 1 ? 'human' : input.botProfile.label, deckId: humanSeat === 1 ? 'human' : 'bot', isAI: humanSeat !== 1, aiLevel: humanSeat === 1 ? 'normal' : 'hard', deck: humanSeat === 1 ? input.humanDeck : input.botDeck }
    ]
  });

  let replayed = 0;
  let guard = 0;

  const resolvePending = (): void => {
    for (;;) {
      const pend = engine.getPending();
      if (!pend) break;
      if (pend.player === humanSeat) {
        const choice = queue.shift();
        if (!choice || choice.type !== 'RESOLVE_CHOICE') {
          throw new ReplayError('escolha do humano ausente ou fora de ordem');
        }
        engine.dispatch({ type: 'RESOLVE_CHOICE', player: humanSeat, selected: choice.selected });
      } else {
        engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(engine.state, pend.player, pend) });
      }
    }
  };

  // --- setup -------------------------------------------------------------
  for (const p of [0, 1] as const) {
    while (engine.state.phase === 'setup' && !engine.state.players[p].setupDone && guard++ < 100) {
      const actor = actorFor(engine);
      if (actor === humanSeat) {
        const cmd = queue.shift();
        if (!cmd) throw new ReplayError('sequência de comandos incompleta no setup');
        const r = engine.dispatch(cmd);
        if (!r.ok) throw new ReplayError(`comando ilegal no setup: ${r.error}`);
      } else {
        const cmd = aiNextCommand(engine, botSeat, input.botProfile);
        const r = engine.dispatch(cmd);
        if (!r.ok) throw new ReplayError(`IA do bot gerou comando ilegal (bug): ${r.error}`);
      }
      replayed++;
      resolvePending();
    }
  }

  // --- jogo ----------------------------------------------------------------
  while (engine.state.phase !== 'gameOver' && guard++ < maxCommands) {
    const actor = actorFor(engine);
    if (actor === humanSeat) {
      const cmd = queue.shift();
      if (!cmd) throw new ReplayError('sequência de comandos incompleta na partida');
      const r = engine.dispatch(cmd);
      if (!r.ok) throw new ReplayError(`comando ilegal: ${r.error}`);
    } else {
      const cmd = aiNextCommand(engine, botSeat, input.botProfile);
      const r = engine.dispatch(cmd);
      if (!r.ok) throw new ReplayError(`IA do bot gerou comando ilegal (bug): ${r.error}`);
    }
    replayed++;
    resolvePending();
  }

  if (engine.state.phase !== 'gameOver') {
    throw new ReplayError('partida não terminou dentro do limite');
  }
  if (queue.length !== 0) {
    throw new ReplayError('comandos excedentes na sequência do humano');
  }
  const winner = engine.state.winner;
  if (winner !== 0 && winner !== 1) throw new ReplayError('partida sem vencedor');

  return { winner, endReason: engine.state.endReason ?? '', turns: engine.state.turn, commandsReplayed: replayed };
}

/** Valida um baralho submetido (ids conhecidos, 60 cartas, regras de deck). */
export function validateSubmittedDeck(cardIds: string[]): { ok: true; deck: CardDef[] } | { ok: false; error: string } {
  if (cardIds.length !== 60) return { ok: false, error: `baralho deve ter 60 cartas (recebido ${cardIds.length})` };
  const deck: CardDef[] = [];
  for (const id of cardIds) {
    const def = registry.tryCard(id);
    if (!def) return { ok: false, error: `carta desconhecida: ${id}` };
    if (id.startsWith('nex-') || id.startsWith('mock-') || id.startsWith('fixture-')) {
      return { ok: false, error: `carta fora do catálogo JET: ${id}` };
    }
    deck.push(def);
  }
  return { ok: true, deck };
}
