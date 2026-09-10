import type { GameEvent, GameEventType, MatchState, PlayerId } from './types';

/**
 * Structured event log. Every state mutation of consequence emits an event.
 * The log drives animations, debugging, match history and (later) replays.
 */
export function emit(state: MatchState, type: GameEventType, player: PlayerId | null, payload: Record<string, unknown> = {}): GameEvent {
  const ev: GameEvent = { seq: state.eventSeq++, turn: state.turn, player, type, payload };
  state.log.push(ev);
  if (state.log.length > 800) state.log.splice(0, state.log.length - 800);
  return ev;
}

export function eventsSince(state: MatchState, seq: number): GameEvent[] {
  return state.log.filter((e) => e.seq > seq);
}
