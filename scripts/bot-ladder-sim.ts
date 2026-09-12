/**
 * BOT LADDER SIMULATION — simula lotes de partidas bot×bot no MatchEngine real
 * e aplica os ratings (Elo) no ladder, mantendo a liderança viva.
 *
 *   npm run ranked:sim -- --games 100 --batch 20
 *
 *  - usa o MESMO engine de produção (IA determinística, sem trapaça);
 *  - cada bot joga com o SEU perfil (StellaPrime elite, Luna hard, etc.);
 *  - o resultado de cada partida é aplicado EXATAMENTE uma vez (idempotente);
 *  - StellaPrime NÃO tem posição travada: se perder, cai no ranking.
 */
import { registerJetDataPack } from '../src/data/jet/pack';
import { ARCHETYPE_DECKS } from '../src/data/jet/archetypes';
import { registry } from '../src/engine/registry';
import { expandDeck } from '../src/data/deckUtils';
import { MatchEngine } from '../src/engine/engine';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import type { AiProfile } from '../src/engine/ai/profile';
import { BOT_ROSTER, botById } from '../src/ranked/bots';
import { MemoryRankedRepo } from '../src/ranked/repo';
import { seedBots } from '../src/ranked/matchmaking';
import { applyRankedResult, leaderboard } from '../src/ranked/ladder';
import { SEASON_1 } from '../src/ranked/seasons';
import type { CardDef } from '../src/engine/types';

registerJetDataPack();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const totalGames = Math.max(1, parseInt(arg('--games', '100'), 10));
const batchSize = Math.max(1, parseInt(arg('--batch', '20'), 10));

function deckFor(archetypeId: string): CardDef[] {
  const d = ARCHETYPE_DECKS.find((x) => x.id === archetypeId);
  if (!d) throw new Error(`arquétipo desconhecido: ${archetypeId}`);
  return expandDeck({ id: d.id, name: d.name, description: '', cards: d.cards }).map((id) => registry.card(id));
}

/** Partida bot×bot determinística (perfis individuais). */
function playBotMatch(aDeck: CardDef[], aProfile: AiProfile, bDeck: CardDef[], bProfile: AiProfile, seed: number): { winner: 0 | 1; turns: number } {
  const engine = new MatchEngine({
    seed,
    players: [
      { name: 'A', deckId: 'a', isAI: true, aiLevel: 'hard', deck: aDeck },
      { name: 'B', deckId: 'b', isAI: true, aiLevel: 'hard', deck: bDeck }
    ]
  });
  const cmd = (p: 0 | 1) => aiNextCommand(engine, p, p === 0 ? aProfile : bProfile);
  const resolve = () => {
    for (;;) {
      const pend = engine.getPending();
      if (!pend) break;
      engine.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(engine.state, pend.player, pend) });
    }
  };
  for (const p of [0, 1] as const) {
    let g = 0;
    while (engine.state.phase === 'setup' && !engine.state.players[p].setupDone && g++ < 40) {
      const r = engine.dispatch(cmd(p));
      if (!r.ok) throw new Error(`setup ilegal: ${r.error}`);
      resolve();
    }
  }
  let g = 0;
  while (engine.state.phase !== 'gameOver' && g++ < 4000) {
    const p = engine.state.activePlayer as 0 | 1;
    const r = engine.dispatch(cmd(p));
    if (!r.ok) throw new Error(`ia ilegal: ${r.error}`);
    resolve();
  }
  if (engine.state.winner !== 0 && engine.state.winner !== 1) throw new Error('partida sem vencedor');
  return { winner: engine.state.winner, turns: engine.state.turn };
}

async function main(): Promise<void> {
  const repo = new MemoryRankedRepo();
  await seedBots(repo);

  const rated = [...BOT_ROSTER].map((b) => ({ id: b.id, rating: b.initialRating })).sort((a, b) => b.rating - a.rating);
  console.log(`JET TCG 2.0 — bot ladder simulation (${totalGames} partidas, lotes de ${batchSize})`);

  let seededRng = 20260912;
  const nextSeed = () => (seededRng = (seededRng * 7919 + 13) % 2147483647);

  for (let batch = 0; batch * batchSize < totalGames; batch++) {
    // pareia bots próximos no rating corrente
    const byRating = [...rated].sort((a, b) => b.rating - a.rating);
    for (let k = 0; k < batchSize && batch * batchSize + k < totalGames; k++) {
      const idx = k % Math.max(1, byRating.length - 1);
      const a = botById(byRating[idx].id)!;
      const b = botById(byRating[idx + 1].id)!;
      const seed = nextSeed();
      const { winner } = playBotMatch(deckFor(a.archetypeId), a.profile, deckFor(b.archetypeId), b.profile, seed);
      const winnerBot = winner === 0 ? a : b;
      const loserBot = winner === 0 ? b : a;
      await applyRankedResult(repo, {
        rankedMatchId: `botladder-${batch}-${k}`,
        seasonId: SEASON_1.id,
        winnerUsername: winnerBot.id,
        loserUsername: loserBot.id
      });
      // reflete o rating no índice local para os próximos pareamentos
      for (const r of rated) {
        const p = await repo.getProfile(r.id);
        if (p) r.rating = p.rating;
      }
    }
  }

  const lb = await leaderboard(repo, 10);
  console.log('\n=== Top 10 do ladder (após simulação) ===');
  for (const e of lb) {
    console.log(`${String(e.position).padStart(2)}. ${e.username.padEnd(18)} ${e.rating} ${e.rank}${e.isReiDaLiga ? ' · REI DA LIGA' : ''}`);
  }
  const stella = lb.find((e) => e.username === 'bot-stella-prime');
  console.log(`\nStellaPrime em #${stella?.position ?? '?'}${stella?.position === 1 ? ' (ainda #1 — sem trava: humanos/outros bots podem ultrapassar)' : ' (não está #1 — sem trava de posição)'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
