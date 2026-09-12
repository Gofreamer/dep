/**
 * META SIMULATION — CLI (Fase 9).
 *
 *   npm run meta:sim -- --games 64 --out reports/meta.md
 *
 * Simula um torneio round-robin entre os arquétipos JET usando o MatchEngine
 * real (IA×IA determinística) e escreve o relatório em markdown + JSON.
 * Volume alvo: >= 1000 partidas no total (decks² × games).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { registerJetDataPack } from '../src/data/jet/pack';
import { ARCHETYPE_DECKS } from '../src/data/jet/archetypes';
import { simulateMeta, formatSimReport } from '../src/meta/simulator';
import { registryReportText } from '../src/data/jet/metrics';

registerJetDataPack();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const gamesPerPair = Math.max(1, parseInt(arg('--games', '12'), 10));
const outFile = resolve(process.cwd(), arg('--out', 'reports/meta.md'));
const levelRaw = arg('--level', 'hard');
const aiLevel = (['easy', 'normal', 'hard'].includes(levelRaw) ? levelRaw : 'hard') as 'easy' | 'normal' | 'hard';
const soft = process.argv.includes('--soft');

const decks = ARCHETYPE_DECKS.map((d) => ({ id: d.id, name: d.name, cards: d.cards }));

const total = decks.length * decks.length * gamesPerPair;
console.log(`JET TCG 2.0 — meta simulation`);
console.log(`${decks.length} decks × ${gamesPerPair} partidas por pareamento = ${total} partidas (IA ${aiLevel})`);
console.log(registryReportText());

const started = Date.now();
const report = simulateMeta(decks, {
  gamesPerPair,
  seedBase: 20260912,
  aiLevel,
  log: (m) => {
    if (process.env.JET_META_VERBOSE) console.log(m);
  }
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`concluído em ${elapsed}s`);

const md = [
  '# JET TCG 2.0 — Meta Report',
  '',
  `Gerado por \`scripts/meta-sim.ts\` — ${report.games} partidas reais IA×IA.`,
  '',
  registryReportText(),
  '',
  formatSimReport(report)
].join('\n');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, md, 'utf8');
writeFileSync(outFile.replace(/\.md$/, '.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`relatório escrito em ${outFile} (+ .json)`);

if (report.dominant.length) {
  console.warn('⚠️ dominância universal detectada (>65%):', report.dominant.map((d) => `${d.deck} ${(d.winRate * 100).toFixed(1)}%`).join(', '));
  if (!soft) process.exitCode = 1;
}
