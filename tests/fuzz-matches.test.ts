import { describe, expect, it } from 'vitest';
import { MatchEngine } from '../src/engine/engine';
import { registry } from '../src/engine/registry';
import { registerDataPack } from '../src/data/fixtures/nexo/cards';
import { registerJetDataPack } from '../src/data/jet/pack';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import { countAllInstances } from '../src/engine/queries';
import type { AiLevel, CardDef, CharacterDef, Command, PlayerId } from '../src/engine/types';

// Registro síncrono (mesmo padrão do every-card-playable).
registerJetDataPack();
registerDataPack();

const ALL = registry.allCards();
const BASES = ALL.filter((d) => d.kind === 'CHARACTER' && (d as CharacterDef).stage === 0);
const RESOURCES = ALL.filter((d) => d.kind === 'RESOURCE');
const OTHERS = ALL.filter((d) => d.kind !== 'RESOURCE' && !(d.kind === 'CHARACTER' && (d as CharacterDef).stage === 0));

// Portão da fase 3: JET_FUZZ_MATCHES=1000 no modo longo; 60 como smoke no `npm test`.
const MATCHES = Number(process.env.JET_FUZZ_MATCHES ?? 60);
const LONG_MODE = process.env.JET_LONG_TESTS === '1';
const MAX_COMMANDS = 800;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deck aleatório de 60 com cobertura garantida: a carta "featured" do match
 *  (e a cadeia de família dela, se personagem de estágio) sempre entra. */
function randomDeck(rng: () => number, featured: CardDef): CardDef[] {
  const deck: CardDef[] = [];
  const push = (d: CardDef, n: number): void => {
    for (let i = 0; i < n && deck.length < 60; i++) deck.push(d);
  };
  push(featured, 4);
  if (featured.kind === 'CHARACTER') {
    const fam = (featured as CharacterDef).family;
    for (const m of ALL) {
      if (m.kind !== 'CHARACTER') continue;
      const mc = m as CharacterDef;
      if (fam && mc.family === fam && mc.stage < (featured as CharacterDef).stage) push(m, 2);
    }
  }
  // esqueleto jogável: bases + recursos + variedade
  for (let i = 0; i < 12; i++) push(BASES[Math.floor(rng() * BASES.length)], 1);
  for (let i = 0; i < 20; i++) push(RESOURCES[Math.floor(rng() * RESOURCES.length)], 1);
  while (deck.length < 60) {
    const pool = Math.floor(rng() * 10) < 5 ? BASES : OTHERS;
    push(pool[Math.floor(rng() * pool.length)], 1);
  }
  return deck;
}

interface MatchStats {
  seed: number;
  commands: number;
  turns: number;
  winner: PlayerId | 'draw' | null;
  endReason: string;
  exercised: Set<string>;
}

function playFuzzMatch(seed: number): MatchStats {
  const rng = mulberry32(seed);
  const featured = ALL[seed % ALL.length];
  const levels: [AiLevel, AiLevel] = [
    (['easy', 'normal', 'hard'] as const)[seed % 3],
    (['easy', 'normal', 'hard'] as const)[(seed >> 2) % 3],
  ];
  const e = new MatchEngine({
    seed,
    players: [
      { name: `F0-${seed}`, deckId: `f0-${seed}`, isAI: true, aiLevel: levels[0], deck: randomDeck(rng, featured) },
      { name: `F1-${seed}`, deckId: `f1-${seed}`, isAI: true, aiLevel: levels[1], deck: randomDeck(rng, featured) },
    ],
  });
  const initialTotal = countAllInstances(e.state).total;
  const exercised = new Set<string>();
  let commands = 0;

  const scanZones = (): void => {
    for (const pl of e.state.players) {
      if (pl.active) {
        exercised.add(pl.active.defId);
        for (const a of pl.active.attached) exercised.add(a.defId);
      }
      for (const c of pl.bench) {
        exercised.add(c.defId);
        for (const a of c.attached) exercised.add(a.defId);
      }
      for (const c of pl.discard) exercised.add(c.defId);
    }
    for (const f of e.state.fields) exercised.add(f.defId);
  };

  const fail = (msg: string): never => {
    throw new Error(`seed=${seed} cmd#${commands} t${e.state.turn} [${e.state.phase}] ${msg} | pending=${JSON.stringify(e.getPending())} | last=${JSON.stringify(e.lastCommand)}`);
  };

  while (e.state.phase !== 'gameOver') {
    if (++commands > MAX_COMMANDS) fail('excesso de comandos (sem fim de jogo)');
    // Durante o setup o estado não alterna activePlayer: o motorista age pelo
    // jogador que ainda não terminou (mesmo contrato do controller real).
    let p: 0 | 1;
    if (e.state.phase === 'setup') {
      p = e.state.players[0].setupDone ? 1 : 0;
      if (e.state.players[p].setupDone) fail('setup: ambos prontos mas a fase não avançou');
    } else {
      p = e.state.activePlayer;
    }
    let cmd: Command;
    try {
      cmd = aiNextCommand(e, p);
    } catch (err) {
      throw new Error(`seed=${seed} cmd#${commands} aiNextCommand lançou: ${(err as Error).message}`);
    }
    const r = e.dispatch(cmd);
    if (!r.ok) fail(`comando ilegal da IA: ${cmd.type} → ${r.error}`);
    const pending = e.getPending();
    if (pending) {
      const sel = aiSmartChoice(e.state, pending.player, pending);
      const rr = e.dispatch({ type: 'RESOLVE_CHOICE', player: pending.player, selected: sel });
      if (!rr.ok) fail(`RESOLVE_CHOICE falhou: ${rr.error} | sel=${JSON.stringify(sel)}`);
    }
    if (commands % 10 === 0) scanZones();
  }
  scanZones();

  // — invariantes de fim de partida (corrupção de zonas) —
  const c = countAllInstances(e.state);
  if (c.total !== initialTotal) fail(`conservação violada: total ${c.total} != inicial ${initialTotal}`);
  const seen = new Set<string>();
  for (const pl of e.state.players) {
    for (const inst of [...(pl.active ? [pl.active] : []), ...pl.bench, ...pl.hand, ...pl.deck, ...pl.discard]) {
      if (seen.has(inst.uid)) fail(`UID duplicado ${inst.uid}`);
      seen.add(inst.uid);
    }
  }
  if (e.getPending()) fail('pending sobrou no fim de jogo');
  const d = e.diagnose();
  if (d.suspicious) fail(`diagnose suspeito no fim: ${d.reasons.join('|')}`);

  return {
    seed,
    commands,
    turns: e.state.turn,
    winner: e.state.winner,
    endReason: e.state.endReason ?? '?',
    exercised,
  };
}

describe('fuzz IA×IA (sem travamento, sem corrupção)', () => {
  const stats: MatchStats[] = [];
  it(`roda ${MATCHES} partidas IA×IA com seeds determinísticas`, () => {
    for (let i = 0; i < MATCHES; i++) stats.push(playFuzzMatch(i));
  }, 600_000);

  it('relata estatísticas agregadas', () => {
    const wins: Record<string, number> = {};
    let cmds = 0;
    let turns = 0;
    for (const s of stats) {
      const w = s.winner === null ? 'none' : String(s.winner);
      wins[w] = (wins[w] ?? 0) + 1;
      cmds += s.commands;
      turns += s.turns;
    }
    const coverage = new Set<string>();
    for (const s of stats) for (const d of s.exercised) coverage.add(d);
    const reasons = new Map<string, number>();
    for (const s of stats) reasons.set(s.endReason, (reasons.get(s.endReason) ?? 0) + 1);
    const maxCmd = stats.reduce((m, s) => Math.max(m, s.commands), 0);
    const summary = {
      matches: stats.length,
      wins,
      avgCommands: Math.round(cmds / stats.length),
      maxCommands: maxCmd,
      avgTurns: Math.round(turns / stats.length),
      endReasons: Object.fromEntries(reasons),
      coverage: `${coverage.size}/${ALL.length}`,
    };
    console.log('[fuzz]', JSON.stringify(summary));
    expect(stats.length).toBe(MATCHES);
    // nenhuma partida pode morrer por exaustão de comandos
    expect(maxCmd).toBeLessThan(MAX_COMMANDS);
  });

  it('cobertura: 100% das CardDefs exercitadas em partidas reais (modo longo)', () => {
    const coverage = new Set<string>();
    for (const s of stats) for (const d of s.exercised) coverage.add(d);
    const missing = ALL.map((d) => d.id).filter((id) => !coverage.has(id));
    if (LONG_MODE) {
      expect(missing).toEqual([]);
    } else if (missing.length > 0) {
      console.log(`[fuzz] cobertura parcial (modo smoke): faltam ${missing.length}/${ALL.length}`);
    }
  });
});
