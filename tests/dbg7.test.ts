import { describe, it } from 'vitest';
import { autoSetup, makeEngine, playUntilEnd } from './helpers';
describe('dbg7', () => {
  it('seed 55 deep', () => {
    const e = makeEngine({ seed: 55 });
    autoSetup(e);
    playUntilEnd(e);
    console.log('phase:', e.state.phase, 'winner:', e.state.winner, 'turn:', e.state.turn, 'loglen:', e.state.log.length);
    const types = new Set(e.state.log.map((ev) => ev.type));
    console.log('CARD_DRAWN:', types.has('CARD_DRAWN'), 'MATCH_STARTED:', types.has('MATCH_STARTED'));
    console.log('draws:', e.state.stats.cardsDrawn);
    console.log('p0 deck:', e.state.players[0].deck.length, 'hand:', e.state.players[0].hand.length);
    console.log('p1 deck:', e.state.players[1].deck.length, 'hand:', e.state.players[1].hand.length);
    console.log('vp:', e.state.players.map((p) => p.victoryPoints));
    console.log('endReason:', e.state.endReason);
  }, 30_000);
});
