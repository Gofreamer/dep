/**
 * scripts/import-jet-tactics.ts
 *
 * Regenerates `src/data/jet/snapshot.ts` from raw captures of the Jet Tactics
 * repository. Usage:
 *
 *   1. Put raw records (JSON) in src/data/jet/raw/:
 *        raw/agents.json    — array de registros de agentes (agents.js / curated-agents*.js)
 *        raw/kits.json      — array de kits curados (passiva/skill/signature/role)
 *        raw/editions.json  — array de edições oficiais (editions.js)
 *        raw/teams.json     — array de equipes oficiais
 *        raw/edition-variants.json — sidegrades curados por agente/edição
 *   2. Run: npx tsx scripts/import-jet-tactics.ts
 *
 * The script NEVER contacts the upstream repository at runtime and NEVER
 * copies credentials, Firebase configs, secrets or authenticated URLs.
 * Every generated record carries provenance (sourceId = file#index).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildSnapshot } from '../src/integrations/jet/normalize';
import type { JetEditionVariant } from '../src/integrations/jet/types';

const RAW_DIR = join(process.cwd(), 'src/data/jet/raw');
const OUT = join(process.cwd(), 'src/data/jet/snapshot.ts');

function readJsonAny(name: string): unknown {
  const file = join(RAW_DIR, name);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function readJson(name: string): Record<string, unknown>[] {
  const file = join(RAW_DIR, name);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf-8'));
  return Array.isArray(parsed) ? parsed : [parsed];
}

function main(): void {
  const sourceCommit = process.argv[2]; // opcional: sha do commit capturado
  const capturedAt = new Date().toISOString().slice(0, 10);
  const snapshot = buildSnapshot({
    capturedAt,
    sourceCommit,
    setName: 'JET CORE SET — Alpha',
    agents: readJson('agents.json'),
    kits: readJson('kits.json'),
    editions: readJson('editions.json'),
    teams: readJson('teams.json')
  });
  snapshot.editionVariants = readJsonAny('edition-variants.json') as JetEditionVariant[];

  const banner = `/**
 * GERADO POR scripts/import-jet-tactics.ts — NÃO EDITAR À MÃO.
 * Captura de ${capturedAt}${sourceCommit ? ` (commit ${sourceCommit})` : ''}.
 * Agentes: ${snapshot.agents.length} · Kits: ${snapshot.kits.length} · Edições: ${snapshot.editions.length} · Equipes: ${snapshot.teams.length} · Sidegrades curados: ${snapshot.editionVariants.length}
 *
 * Fonte: RocksXB/jet-tactics @ ${sourceCommit ?? '?'} (repo real: "jet-tactics." com ponto final)
 * docs/CURATED_ROSTER_v0.1.md + js/game/curated-agents-1..6.js + js/game/editions.js
 */`;

  const body = `import type { JetSnapshot } from '../../integrations/jet/types';

export const JET_SNAPSHOT: JetSnapshot = ${JSON.stringify(snapshot, null, 2)};
`;

  writeFileSync(OUT, `${banner}\n${body}`);
  console.log(`✓ snapshot.ts regenerado: ${snapshot.agents.length} agentes, ${snapshot.editions.length} edições, ${snapshot.teams.length} equipes, ${snapshot.editionVariants.length} sidegrades.`);
  console.log('Próximo passo: curar perfis TCG em src/data/jet/agentProfiles.ts (status CURATED por edição).');
}

main();
