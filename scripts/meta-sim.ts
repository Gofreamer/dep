/**
 * META SIMULATION — CLI (Fase 21–25 da 2.1).
 *
 *   npm run meta:sim -- --games 8 --seeds 4 --out reports/meta.md   # 4 replicações
 *   npm run meta:sim -- --games 16 --seeds 8 --level elite          # escada de IA
 *   npm run meta:sim -- --games 4 --level normal --soft     # smoke (não falha)
 *
 * Roda um torneio round-robin entre os arquétipos JET com o MatchEngine real
 * (IA×IA determinística) e escreve o relatório em markdown + JSON.
 *
 * Volume: `--games N` = partidas POR PAR (não ordenado, com os dois assentos
 * alternados) e `--seeds S` replicações independentes. Total = pares × N × S,
 * onde pares = d(d+1)/2. Com 8 decks e `--games 8 --seeds 2` são 144 partidas.
 *
 * GATE DE RELEASE (default, sem `--soft`): falha se qualquer arquétipo ficar
 * acima de 65% ou abaixo de 35% do field, se algum matchup direto passar de
 * 80%/20%, ou se a matriz não fechar 100% (inconsistência de medição).
 * `--soft` existe só para smoke de desenvolvimento — o job de release da CI
 * roda SEM `--soft`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { registerJetDataPack } from '../src/data/jet/pack';
import { ARCHETYPE_DECKS } from '../src/data/jet/archetypes';
import { simulateMeta, formatSimReport, assertMatrixConsistent, type SimReport } from '../src/meta/simulator';
import { registryReportText } from '../src/data/jet/metrics';

registerJetDataPack();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const gamesPerPair = Math.max(2, parseInt(arg('--games', '12'), 10));
const outFile = resolve(process.cwd(), arg('--out', 'reports/meta.md'));
const levelRaw = arg('--level', 'hard');
const AI_LEVELS = ['easy', 'normal', 'hard', 'elite'] as const;
type Lvl = (typeof AI_LEVELS)[number];
const aiLevel: Lvl = (AI_LEVELS as readonly string[]).includes(levelRaw) ? (levelRaw as Lvl) : 'hard';
const soft = process.argv.includes('--soft');
/** `--seeds 4` = 4 replicações com bases determinísticas; `--seeds 1,2,3` = lista. */
function parseSeeds(raw: string): number[] {
  const BASES = [20260912, 777, 131071, 20260913, 424242, 987654321, 31337, 8675309];
  if (raw.includes(',')) {
    const list = raw.split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
    return list.length ? list : [20260912];
  }
  const n = Math.max(1, parseInt(raw, 10) || 1);
  return Array.from({ length: n }, (_, i) => BASES[i % BASES.length] + Math.floor(i / BASES.length) * 1_000_003);
}
const seeds = parseSeeds(arg('--seeds', '2'));

const HI = 0.65;
const LO = 0.35;
const BRUTAL = 0.8;

const decks = ARCHETYPE_DECKS.map((d) => ({ id: d.id, name: d.name, cards: d.cards }));
const pairs = (decks.length * (decks.length + 1)) / 2;
const total = pairs * gamesPerPair * seeds.length;
console.log('JET TCG 2.1 — meta simulation');
console.log(`${decks.length} decks · ${gamesPerPair} partidas/par · ${seeds.length} seeds = ${total} partidas (IA ${aiLevel})`);
console.log(registryReportText());

const started = Date.now();
const report: SimReport = simulateMeta(decks, {
  gamesPerPair,
  seeds,
  aiLevel,
  log: (m) => { if (process.env.JET_META_VERBOSE) console.log(m); }
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`concluído em ${elapsed}s · ${report.games} partidas`);

// --- verificação da própria medição (Fase 22) ------------------------------
let matrixError: string | null = null;
try {
  assertMatrixConsistent(report);
} catch (e) {
  matrixError = (e as Error).message;
}

// --- espelhos: desvio máximo em relação a 50% ------------------------------
const mirrorWorst = report.decks
  .map((d) => ({ id: d.id, rate: report.mirror[d.id] ?? 0.5 }))
  .sort((a, b) => Math.abs(b.rate - 0.5) - Math.abs(a.rate - 0.5))[0];

/** σ de uma proporção (n de partidas independentes, p≈0.5). */
const sig = (n: number) => (n > 0 ? Math.sqrt(0.25 / n) : 1);
const fp = report.firstPlayer;
/**
 * Vantagem de assento medida nos ESPelhos: é a única leitura sem confusão com
 * força de baralho. A regra de primeiro turno (quem abre não ataca no turno 1)
 * é simétrica por construção, então o esperado é 50% dentro do ruído.
 * Só entra no gate com amostra ≥ 96 partidas de espelho; abaixo disso é aviso.
 */
const mirrorP0 = fp.mirrorGames ? fp.mirrorP0Wins / fp.mirrorGames : 0.5;
const starterRate = fp.starterGames ? fp.starterWins / fp.starterGames : 0.5;
const mirrorTol = Math.max(0.05, 2 * sig(fp.mirrorGames));
const mirrorSeatOk = Math.abs(mirrorP0 - 0.5) <= mirrorTol;

const md = [
  '# JET TCG 2.1 — Meta Report',
  '',
  `Gerado por \`scripts/meta-sim.ts\` — ${report.games} partidas reais IA×IA`,
  `(${gamesPerPair} partidas por par × ${seeds.length} seeds, alternando quem abre).`,
  '',
  registryReportText(),
  '',
  formatSimReport(report),
  '',
  `### Verificações da medição`,
  `- matriz A×B + B×A = 100%: **${matrixError ? 'FALHOU' : 'OK'}**${matrixError ? `\n\n\`\`\`\n${matrixError}\n\`\`\`` : ''}`,
  `- espelho mais desviado de 50%: ${mirrorWorst ? `${mirrorWorst.id} ${(mirrorWorst.rate * 100).toFixed(1)}%` : 'n/d'} (desvio por amostragem; sinal de seed/assento bias se persistir com muitas seeds)`,
  `- vantagem de quem abre (todas): ${((fp.p0Wins / Math.max(1, fp.games)) * 100).toFixed(1)}% P0 vs ${((fp.p1Wins / Math.max(1, fp.games)) * 100).toFixed(1)}% P1 — n=${fp.games}, σ=${(sig(fp.games) * 100).toFixed(1)}pp. Em cross-matchups isso reflete TAMBÉM interação baralho×assento, não só a regra de turno; o número limpo é o dos espelhos.`,
  `- vantagem de quem abre (espelhos): ${(mirrorP0 * 100).toFixed(1)}% P0 em ${fp.mirrorGames} partidas · tolerância ±${(mirrorTol * 100).toFixed(1)}pp · **${mirrorSeatOk ? 'OK' : 'FORA DA FAIXA'}**`,
  '',
  '### Nota de leitura',
  'A IA usada na simulação é a mesma de produção (heurística + lookahead, sem',
  'trapaça). Ela só lê o estado público; por isso planos que dependem de',
  'setup/combo/negação exigem avaliação correta do avaliador — o meta-sim é a',
  'ferramenta que detecta quando o problema é o baralho e quando é a IA.',
  ''
].join('\n');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, md, 'utf8');
writeFileSync(outFile.replace(/\.md$/, '.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`relatório escrito em ${outFile} (+ .json)`);

// --- gate ------------------------------------------------------------------
const problems: string[] = [];
if (matrixError) problems.push(`matriz inconsistente: ${matrixError}`);
for (const d of report.dominant) problems.push(`dominância >${HI * 100}%: ${d.deck} ${(d.winRate * 100).toFixed(1)}%`);
for (const d of report.weak) problems.push(`piso <${LO * 100}%: ${d.deck} ${(d.winRate * 100).toFixed(1)}%`);
// O gate de matchup exige amostra: 4 partidas por par não distinguem 75% de 50%.
const perPair = gamesPerPair * seeds.length;
if (perPair >= 24) {
  for (const m of report.brutalMatchups) problems.push(`matchup sem counterplay: ${m.a} vs ${m.b} ${(m.rate * 100).toFixed(1)}%`);
} else {
  for (const m of report.brutalMatchups) console.warn(`  · (amostra ${perPair}/par — só aviso) matchup ${m.a} vs ${m.b} ${(m.rate * 100).toFixed(1)}%`);
}

if (fp.mirrorGames >= 96 && !mirrorSeatOk) {
  problems.push(`viés de assento na regra de primeiro turno: espelhos com P0 em ${(mirrorP0 * 100).toFixed(1)}% (esperado 50% ±${(mirrorTol * 100).toFixed(1)}pp)`);
} else if (fp.mirrorGames < 96 && !mirrorSeatOk) {
  console.warn(`  · (amostra ${fp.mirrorGames} de espelhos — só aviso) P0 ${(mirrorP0 * 100).toFixed(1)}%`);
}
if (seeds.length < 2 && !soft) {
  problems.push(`--seeds ${seeds.length}: uma semente não mede variância; o gate de release exige ≥2 replicações`);
}

if (problems.length) {
  console.warn(`⚠️ ${problems.length} problema(s) de balanceamento:`);
  for (const p of problems) console.warn(`  - ${p}`);
  if (!soft) {
    console.error(`gate de meta reprovado (${problems.length} problemas). \`--soft\` só para smoke de dev.`);
    process.exitCode = 1;
  } else {
    console.warn('(modo --soft: avisos, sem falhar)');
  }
} else {
  console.log(`✅ meta dentro dos gates (todos os arquétipos em ${LO * 100}–${HI * 100}%${perPair >= 24 ? `, nenhum matchup ≥${BRUTAL * 100}%` : ' — gate de matchup exige ≥24 partidas/par'}, assento sem viés)`);
}
