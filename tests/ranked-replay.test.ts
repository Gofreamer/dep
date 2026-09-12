import { describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { ARCHETYPE_DECKS } from '../src/data/jet/archetypes';
import { registry } from '../src/engine/registry';
import { expandDeck } from '../src/data/deckUtils';
import { computeLegalActions } from '../src/engine/validation';
import { PROFILE_LEVELS } from '../src/engine/ai/profile';
import { replayMatch, ReplayError, validateSubmittedDeck } from '../src/ranked/replay';
import { runLocalRankedMatch } from '../src/ranked/localMatch';
import type { MatchEngine } from '../src/engine/engine';
import type { Command, PlayerId } from '../src/engine/types';

registerJetDataPack();

function deckFor(archetypeId: string) {
  const d = ARCHETYPE_DECKS.find((x) => x.id === archetypeId)!;
  return expandDeck({ id: d.id, name: d.name, description: '', cards: d.cards }).map((id) => registry.card(id));
}

/**
 * Política determinística para o "humano" do teste: NÃO consome RNG (rand()),
 * diferente de aiNextCommand — assim o replay server-side reproduz a partida
 * byte a byte (a IA do bot é a única consumidora de RNG, igual em ambos).
 */
function deterministicHuman(engine: MatchEngine, seat: PlayerId): Command {
  const state = engine.state;
  const legal = computeLegalActions(state, seat, 0);
  if (state.phase === 'setup') {
    const p = state.players[seat];
    if (!p.active && legal.setupActive.length) return { type: 'SETUP_SET_ACTIVE', player: seat, uid: legal.setupActive[0] };
    const b = legal.setupBench.find((uid) => uid !== p.active?.uid);
    if (p.bench.length < 2 && b) return { type: 'SETUP_BENCH', player: seat, uid: b };
    return { type: 'SETUP_DONE', player: seat };
  }
  if (legal.deployable.length) return { type: 'DEPLOY_CHARACTER', player: seat, uid: legal.deployable[0] };
  const p = state.players[seat];
  const res = p.hand.find((c) => c.kind === 'RESOURCE');
  if (res && p.attachedThisTurn < state.config.turn.attachPerTurn) {
    const target = p.active ?? p.bench[0];
    if (target) return { type: 'ATTACH_RESOURCE', player: seat, uid: res.uid, targetUid: target.uid };
  }
  if (legal.playableActions.length) return { type: 'PLAY_ACTION', player: seat, uid: legal.playableActions[0] };
  const atk = legal.attacks.find((a) => a.playable);
  if (atk) return { type: 'ATTACK', player: seat, attackId: atk.attackId };
  return { type: 'END_TURN', player: seat };
}

describe('replay server-side (o servidor determina o resultado)', () => {
  it('replay válido reproduz o mesmo vencedor da partida local', () => {
    const humanDeck = deckFor('archetype-midrange');
    const botDeck = deckFor('archetype-aggro');
    const botProfile = PROFILE_LEVELS.elite;
    const seed = 424242;
    const humanSeat = 0 as const;

    const local = runLocalRankedMatch({
      seed, humanDeck, botDeck, botProfile, humanSeat,
      humanMove: (e) => deterministicHuman(e, humanSeat)
    });

    const outcome = replayMatch({ seed, humanDeck, botDeck, botProfile, humanSeat, commands: local.humanCommands });
    expect(outcome.winner).toBe(local.winner);
    expect(outcome.endReason).toBe(local.endReason);
  });

  it('rejeita comando ilegal (resultado não confiável)', () => {
    const humanDeck = deckFor('archetype-midrange');
    const botDeck = deckFor('archetype-aggro');
    const seed = 777;
    const humanSeat = 0 as const;
    const local = runLocalRankedMatch({
      seed, humanDeck, botDeck, botProfile: PROFILE_LEVELS.elite, humanSeat,
      humanMove: (e) => deterministicHuman(e, humanSeat)
    });
    // corrompe o primeiro comando: um END_TURN durante o setup
    const tampered = [{ type: 'END_TURN', player: humanSeat } as any, ...local.humanCommands.slice(1)];
    expect(() => replayMatch({ seed, humanDeck, botDeck, botProfile: PROFILE_LEVELS.elite, humanSeat, commands: tampered })).toThrow(ReplayError);
  });

  it('rejeita sequência incompleta', () => {
    const humanDeck = deckFor('archetype-midrange');
    const botDeck = deckFor('archetype-aggro');
    expect(() =>
      replayMatch({ seed: 999, humanDeck, botDeck, botProfile: PROFILE_LEVELS.elite, humanSeat: 0, commands: [] })
    ).toThrow(ReplayError);
  });

  it('valida baralho submetido (60 cartas JET, sem fixture)', () => {
    const ok = validateSubmittedDeck(deckFor('archetype-aggro').map((c) => c.id));
    expect(ok.ok).toBe(true);
    expect(validateSubmittedDeck(['nexo-x', 'nexo-y']).ok).toBe(false);
    expect(validateSubmittedDeck(deckFor('archetype-aggro').slice(0, 40).map((c) => c.id)).ok).toBe(false);
  });
});
