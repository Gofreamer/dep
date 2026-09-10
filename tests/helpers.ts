import { beforeAll } from 'vitest';
import { MatchEngine } from '../src/engine/engine';
import type { AiLevel, Command, GameConfig } from '../src/engine/types';
import { DEFAULT_CONFIG } from '../src/engine/types';
import { registerDataPack } from '../src/data/cards';
import { STARTER_DECKS, expandDeck } from '../src/data/decks';
import { registry } from '../src/engine/registry';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';

export function setup() {
  beforeAll(() => { registerDataPack(); });
}

export function deckOf(starterId: string): string[] {
  const def = STARTER_DECKS.find((d) => d.id === starterId) ?? STARTER_DECKS[0];
  return expandDeck(def);
}

export function makeEngine(opts: {
  seed?: number;
  p0?: string[];
  p1?: string[];
  config?: Partial<GameConfig>;
  levels?: [AiLevel, AiLevel];
  aiChooser?: (state: any, req: any) => string[];
} = {}): MatchEngine {
  registerDataPack();
  const build = (ids: string[]) => ids.map((id) => registry.card(id));
  return new MatchEngine({
    seed: opts.seed ?? 12345,
    config: { ...DEFAULT_CONFIG, ...(opts.config ?? {}) } as GameConfig,
    aiChooser: opts.aiChooser as any,
    players: [
      { name: 'Aluno', deckId: 'test0', isAI: !!opts.levels, aiLevel: opts.levels?.[0] ?? 'normal', deck: build(opts.p0 ?? deckOf('deck-furia-solar')) },
      { name: 'Máquina', deckId: 'test1', isAI: true, aiLevel: opts.levels?.[1] ?? 'normal', deck: build(opts.p1 ?? deckOf('deck-controle-tatico')) }
    ]
  });
}

/** Runs the setup phase with simple heuristics for both players. */
export function autoSetup(engine: MatchEngine): void {
  for (const p of [0, 1] as const) {
    let guard = 0;
    while (engine.state.phase === 'setup' && guard++ < 30) {
      const st = engine.state;
      const player = st.players[p];
      if (!player.setupDone) {
        if (!player.active) {
          const basic = player.hand.find((c) => c.kind === 'CHARACTER' && (registry.card(c.defId) as any).stage === 0);
          if (!basic) throw new Error('sem básico');
          engine.dispatch({ type: 'SETUP_SET_ACTIVE', player: p, uid: basic.uid });
        } else if (player.bench.length < 2 && player.hand.some((c) => c.kind === 'CHARACTER' && (registry.card(c.defId) as any).stage === 0)) {
          const c = player.hand.find((x) => x.kind === 'CHARACTER' && (registry.card(x.defId) as any).stage === 0)!;
          engine.dispatch({ type: 'SETUP_BENCH', player: p, uid: c.uid });
        } else {
          engine.dispatch({ type: 'SETUP_DONE', player: p });
        }
      }
    }
  }
}

/** Plays AI turns until the match ends (guard against infinite loops). */
export function playUntilEnd(engine: MatchEngine, maxCommands = 800): void {
  let guard = 0;
  while (engine.state.phase !== 'gameOver' && guard++ < maxCommands) {
    const p = engine.state.activePlayer;
    const cmd: Command = aiNextCommand(engine, p);
    const r = engine.dispatch(cmd);
    if (!r.ok && cmd.type !== 'END_TURN') {
      // safety: skip turn on unexpected invalid command
      engine.dispatch({ type: 'END_TURN', player: p });
    }
    const pending = engine.getPending();
    if (pending) {
      engine.dispatch({ type: 'RESOLVE_CHOICE', player: pending.player, selected: aiSmartChoice(engine.state, pending.player, pending) });
    }
  }
}
