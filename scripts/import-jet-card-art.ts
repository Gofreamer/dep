/**
 * scripts/import-jet-card-art.ts
 *
 * Gera `src/data/jet/artSnapshot.ts` (snapshot pequeno, limpo e versionado
 * das artes oficiais) a partir do repositório público Jet Cards.
 *
 * Uso:
 *   1. Clone a fonte SOMENTE como leitura temporária (fora do repo do TCG):
 *        git clone --depth 1 https://github.com/Gofreamer/cartinhas23.git /tmp/cartinhas23
 *   2. Rode:
 *        npx tsx scripts/import-jet-card-art.ts
 *      (alternativa sem rede extra: `npx vite-node scripts/import-jet-card-art.ts`)
 *
 * Opções:
 *   --source <path>      seed JSON da fonte (padrão: /tmp/cartinhas23/seed-cards-import.json)
 *   --source-dir <path>   clone da fonte p/ ler o SHA via git (padrão: /tmp/cartinhas23)
 *   --commit <sha>        SHA da fonte (padrão: `git -C <source-dir> rev-parse HEAD`)
 *   --out <path>          saída (padrão: src/data/jet/artSnapshot.ts)
 *   --allow-http          permite http: (NUNCA em produção — só dev local)
 *   --check               não escreve; falha (exit 1) se o snapshot atual
 *                         estiver desatualizado em relação à fonte
 *
 * O script NUNCA copia Firebase config/credenciais/regras, inventários,
 * usuários, preços, packs ou qualquer infraestrutura do Fórum — lê SOMENTE
 * `players[*].photo|photoUrl|image` e `cards.specials[*].specialImageUrl`.
 * O TCG resultante é standalone: depois de gerado, o snapshot basta —
 * runtime nunca consulta a fonte, o Fórum ou o Firebase.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JET_SNAPSHOT } from '../src/data/jet/snapshot';
import {
  buildArtSnapshot,
  type JetCardsPlayerSeed,
  type JetCardsSpecialSeed
} from '../src/integrations/jet/cardArt';

interface CliOptions {
  source: string;
  sourceDir: string;
  commit?: string;
  out: string;
  allowHttp: boolean;
  check: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    source: '/tmp/cartinhas23/seed-cards-import.json',
    sourceDir: '/tmp/cartinhas23',
    out: join(process.cwd(), 'src/data/jet/artSnapshot.ts'),
    allowHttp: false,
    check: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source') opts.source = argv[++i];
    else if (arg === '--source-dir') opts.sourceDir = argv[++i];
    else if (arg === '--commit') opts.commit = argv[++i];
    else if (arg === '--out') opts.out = resolve(argv[++i]);
    else if (arg === '--allow-http') opts.allowHttp = true;
    else if (arg === '--check') opts.check = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Uso: npx tsx scripts/import-jet-card-art.ts [--source P] [--source-dir D] [--commit SHA] [--out F] [--allow-http] [--check]');
      process.exit(0);
    } else {
      throw new Error(`argumento desconhecido: ${arg} (use --help)`);
    }
  }
  return opts;
}

function readSourceCommit(sourceDir: string, override?: string): string {
  if (override) return override.trim();
  try {
    return execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error(
      `não foi possível ler o SHA da fonte via 'git -C ${sourceDir} rev-parse HEAD'. ` +
        `Clone https://github.com/Gofreamer/cartinhas23.git em ${sourceDir} ou passe --commit <sha>.`
    );
  }
}

function printReport(report: ReturnType<typeof buildArtSnapshot>['report']): void {
  const line = (label: string, value: string | number): void => {
    console.log(`  ${label}: ${value}`);
  };
  console.log('— Auditoria das artes (calculada dos dados, nada inventado) —');
  line('registros na fonte (jogadores)', report.sourceRecords.players);
  line('registros na fonte (especiais)', report.sourceRecords.specials);
  line('agentes BASE do TCG reconhecidos', report.baseRecognized);
  line('especiais do TCG reconhecidos', report.specialsRecognized);
  line('URLs distintas no snapshot', report.distinctUrls);
  line('snapshot: GitHub', report.origins.github);
  line('snapshot: GitHub Pages', report.origins['github-pages']);
  line('snapshot: Imgur', report.origins.imgur);
  line('snapshot: outras origens', report.origins.other);
  line('fonte inteira: URLs distintas válidas', report.sourceDistinctUrls);
  line('fonte inteira: GitHub', report.sourceOrigins.github);
  line('fonte inteira: GitHub Pages', report.sourceOrigins['github-pages']);
  line('fonte inteira: Imgur', report.sourceOrigins.imgur);
  line('fonte inteira: outras origens', report.sourceOrigins.other);
  line('URLs inválidas (protocolo rejeitado)', report.invalidUrls.length);
  for (const inv of report.invalidUrls) console.log(`    - ${inv.where}: ${inv.url.slice(0, 120)}`);
  line('registros sem imagem', report.recordsWithoutImage.length);
  for (const key of report.recordsWithoutImage) console.log(`    - ${key}`);
  line('jogadores sem matching TCG (elenco fora do TCG — esperado)', report.unmatchedPlayers.length);
  line('especiais sem matching', report.unmatchedSpecials.length);
  for (const key of report.unmatchedSpecials) console.log(`    - ${key}`);
  line('matchings ambíguos (rejeitados)', report.ambiguous.length);
  for (const amb of report.ambiguous) console.log(`    - '${amb.normalized}': ${amb.candidates.join(', ')}`);
  line('agentes TCG sem arte BASE', report.tcgAgentsWithoutBaseArt.length);
  for (const id of report.tcgAgentsWithoutBaseArt) console.log(`    - ${id}`);
  line('especiais jogáveis sem specialImageUrl', report.tcgEditionsWithoutSpecialArt.length);
  for (const spec of report.tcgEditionsWithoutSpecialArt) console.log(`    - ${spec.name} (${spec.identityId}) ${spec.edition}`);
  line('warnings', report.warnings.length);
  for (const warning of report.warnings) console.log(`    - [${warning.code}] ${warning.message}`);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.source)) {
    throw new Error(
      `fonte não encontrada: ${opts.source}\n` +
        `Clone primeiro: git clone --depth 1 https://github.com/Gofreamer/cartinhas23.git /tmp/cartinhas23`
    );
  }
  const seed = JSON.parse(readFileSync(opts.source, 'utf-8')) as {
    players?: Record<string, JetCardsPlayerSeed>;
    cards?: { specials?: Record<string, JetCardsSpecialSeed> };
  };
  const players = seed.players ?? {};
  const specials = seed.cards?.specials ?? {};
  const sourceCommit = readSourceCommit(opts.sourceDir, opts.commit);
  const capturedAt = new Date().toISOString().slice(0, 10);

  const tcgAgents = JET_SNAPSHOT.agents.map((a) => ({ agentId: a.agentId, name: a.name, team: a.team }));
  const playableSpecials = JET_SNAPSHOT.editionVariants.map((v) => ({ identityId: v.agentId, edition: v.edition }));
  const { snapshot, report } = buildArtSnapshot({
    players,
    specials,
    tcgAgents,
    playableSpecials,
    sourceCommit,
    capturedAt,
    allowHttp: opts.allowHttp
  });

  console.log(`Fonte: Gofreamer/cartinhas23 @ ${sourceCommit} (${opts.source})`);
  printReport(report);

  if (opts.check) {
    if (!existsSync(opts.out)) {
      console.error(`--check: snapshot ausente (${opts.out}) — rode o importador.`);
      process.exit(1);
    }
    const current = readFileSync(opts.out, 'utf-8');
    let same = false;
    try {
      // Extrai o objeto literal do snapshot e compara semanticamente
      // (entradas + commit; a data de captura pode variar sem mudar dados).
      const start = current.indexOf('{', current.indexOf('JET_ART_SNAPSHOT'));
      const parsed = JSON.parse(current.slice(start, current.lastIndexOf('}') + 1)) as {
        provenance?: { sourceCommit?: string };
        entries?: unknown;
      };
      same =
        parsed.provenance?.sourceCommit === sourceCommit &&
        JSON.stringify(parsed.entries) === JSON.stringify(snapshot.entries);
    } catch {
      same = false;
    }
    if (!same) {
      console.error('--check: snapshot desatualizado em relação à fonte — rode o importador e commite o resultado.');
      process.exit(1);
    }
    console.log('✓ --check: snapshot atualizado.');
    return;
  }

  const banner = `/**
 * GERADO POR scripts/import-jet-card-art.ts — NÃO EDITAR À MÃO.
 * Captura de ${capturedAt} (commit ${sourceCommit}).
 * Agentes BASE com arte: ${report.baseRecognized} · Especiais com arte: ${report.specialsRecognized} · URLs distintas: ${report.distinctUrls}
 *
 * Fonte: Gofreamer/cartinhas23 @ ${sourceCommit} (seed-cards-import.json)
 * players[*].photo|photoUrl|image + cards.specials[*].specialImageUrl.
 * Runtime NUNCA consulta a fonte/Fórum/Firebase — só as URLs públicas das imagens.
 */`;

  const body = `import type { JetArtSnapshot } from '../../integrations/jet/cardArt';

export const JET_ART_SNAPSHOT: JetArtSnapshot = ${JSON.stringify(snapshot, null, 2)};
`;

  writeFileSync(opts.out, `${banner}\n${body}`);
  console.log(`✓ artSnapshot.ts regenerado: ${snapshot.entries.length} entradas (${report.baseRecognized} BASE + ${report.specialsRecognized} especiais).`);
  console.log(`  → ${opts.out}`);
  if (report.ambiguous.length > 0 || report.invalidUrls.length > 0) {
    console.log('  ⚠ há ambiguidades/URLs inválidas acima — revise antes de commitar.');
  }
}

main();
