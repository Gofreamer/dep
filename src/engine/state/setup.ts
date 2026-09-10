import type { CardDef, MatchState, PlayerId, PlayerState } from '../types';
import { DEFAULT_CONFIG } from '../types';
import { registry } from '../registry';
import { newCardInstance, shuffleDeck, G } from '../effects/shared';

export interface PlayerSetup {
  name: string;
  deckId: string;
  isAI: boolean;
  aiLevel: PlayerState['aiLevel'];
  deck: CardDef[];
}

export interface MatchOptions {
  seed: number;
  config?: Partial<typeof DEFAULT_CONFIG>;
  players: [PlayerSetup, PlayerSetup];
}

/** Builds a fresh, shuffled, fully dealt-in match state (setup phase). */
export function createMatchState(opts: MatchOptions): MatchState {
  const config = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };
  const state: MatchState = {
    id: `match-${opts.seed}`,
    seed: opts.seed,
    rngState: opts.seed >>> 0 || 0x9e3779b9,
    turn: 0,
    activePlayer: 0,
    phase: 'setup',
    config,
    nextUid: 0,
    triggerQueue: [],
    players: [
      makePlayer(0, opts.players[0]),
      makePlayer(1, opts.players[1])
    ],
    fields: [],
    fieldOverrides: [],
    tempMods: [],
    log: [],
    eventSeq: 1,
    winner: null,
    endReason: null,
    resolvingCardUid: null,
    lastAttack: null,
    startingPlayer: 0,
    stats: { damage: [0, 0], healed: [0, 0], cardsDrawn: [0, 0] }
  };
  const g: G = {
    state,
    emit: (type, player, payload) => { emitInline(state, type, player, payload); }
  };
  for (const ps of opts.players) {
    const p = state.players[ps.name === opts.players[0].name ? 0 : 1];
    void p;
  }
  // Instantiate decks
  (opts.players as unknown as PlayerSetup[]).forEach((ps, i) => {
    const insts = ps.deck.map((def) => {
      registry.card(def.id); // ensure registered
      return newCardInstance(g, def, i as PlayerId);
    });
    state.players[i as PlayerId].deck = insts;
    shuffleDeck(g, i as PlayerId);
  });
  return state;
}

function makePlayer(i: PlayerId, ps: PlayerSetup): PlayerState {
  return {
    index: i,
    name: ps.name,
    isAI: ps.isAI,
    aiLevel: ps.aiLevel,
    deckId: ps.deckId,
    deck: [],
    hand: [],
    active: null,
    bench: [],
    discard: [],
    victoryPoints: 0,
    attachedThisTurn: 0,
    retreatedThisTurn: 0,
    actionsPlayedTurn: [],
    setupDone: false
  };
}

function emitInline(state: MatchState, type: any, player: PlayerId | null, payload: Record<string, unknown> = {}): void {
  state.log.push({ seq: state.eventSeq++, turn: state.turn, player, type, payload });
  if (state.log.length > 3000) state.log.splice(0, state.log.length - 3000);
}

export { emitInline };
