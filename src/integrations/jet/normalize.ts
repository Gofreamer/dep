import type { JetAgentIdentity, JetAgentKit, JetEditionDef, JetSnapshot, JetTeamDef } from './types';

/**
 * Normalizer: turns raw records captured from the Jet Tactics repository
 * (arbitrary JS object shapes from jet-cards.js / agents.js /
 * curated-agents*.js / editions.js) into the typed JetSnapshot model.
 *
 * The normalizer is defensive and tolerant: unknown shapes degrade to
 * explicit "pending" records instead of guesses. It NEVER invents data that
 * is absent — missing fields stay undefined.
 */

type Raw = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Raw | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function pick(raw: Raw, keys: string[]): unknown {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return undefined;
}

function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Normalizes one agent record. `sourceId` points at the exact source record. */
export function normalizeAgent(raw: Raw, capturedAt: string, sourceCommit?: string): JetAgentIdentity {
  const name = str(pick(raw, ['name', 'nome', 'displayName'])) ?? 'AGENTE_SEM_NOME';
  const editions = arr(pick(raw, ['editions', 'edicões', 'variants']))
    .map((e) => (typeof e === 'string' ? e : str(obj(e)?.['id'] ?? obj(e)?.['name'])))
    .filter((e): e is string => !!e);
  return {
    agentId: str(pick(raw, ['agentId', 'id', 'key'])) ?? `agent-${slug(name)}`,
    playerKey: str(pick(raw, ['playerKey', 'player', 'key'])),
    name,
    team: str(pick(raw, ['team', 'equipe', 'teamId'])),
    rank: str(pick(raw, ['rank', 'patente'])),
    description: str(pick(raw, ['description', 'descricao', 'bio', 'summary'])),
    imageUrl: str(pick(raw, ['imageUrl', 'image', 'artwork', 'art', 'portrait'])),
    editions,
    provenance: {
      sourceRepository: 'RocksXB/jet-tactics',
      sourceType: 'curated-agents',
      sourceId: str(pick(raw, ['__sourceId'])) ?? name,
      capturedAt,
      sourceCommit
    }
  };
}

/** Normalizes one competitive kit (passiva/skill/signature [+ ultimate oficial]). */
export function normalizeKit(raw: Raw, capturedAt: string, sourceCommit?: string): JetAgentKit {
  const abilitySeed = (v: unknown): JetAgentKit['passive'] => {
    const o = obj(v);
    if (!o) return undefined;
    const name = str(pick(o, ['name', 'nome']));
    const description = str(pick(o, ['description', 'descricao', 'desc', 'text']));
    if (!name && !description) return undefined;
    return { name: name ?? '', description: description ?? '' };
  };
  const agentId = str(pick(raw, ['agentId', 'id', 'key'])) ?? 'AGENT_SEM_ID';
  return {
    agentId,
    edition: str(pick(raw, ['edition', 'edicao'])),
    role: str(pick(raw, ['role', 'papel', 'classe'])),
    archetype: str(pick(raw, ['archetype', 'arquetipo'])),
    summary: str(pick(raw, ['summary', 'resumo', 'description'])),
    passive: abilitySeed(pick(raw, ['passive', 'passiva', 'passiva_'])),
    skill: abilitySeed(pick(raw, ['skill', 'habilidade'])),
    signature: abilitySeed(pick(raw, ['signature', 'golpe_assinatura', 'ultimateSignature'])),
    ultimate: abilitySeed(pick(raw, ['suprema', 'supreme', 'ultimateOfficial'])),
    stats: obj(pick(raw, ['stats', 'power', 'poderes'])) as Record<string, number> | undefined,
    provenance: {
      sourceRepository: 'RocksXB/jet-tactics',
      sourceType: 'curated-agents',
      sourceId: str(pick(raw, ['__sourceId'])) ?? agentId,
      capturedAt,
      sourceCommit
    }
  };
}

export function normalizeEdition(raw: Raw, capturedAt: string, sourceCommit?: string): JetEditionDef {
  const id = str(pick(raw, ['id', 'key'])) ?? 'UNKNOWN';
  return {
    id,
    name: str(pick(raw, ['name', 'nome', 'label'])) ?? id,
    sidegradeIntent: str(pick(raw, ['sidegrade', 'intent', 'description', 'descricao'])),
    provenance: { sourceRepository: 'RocksXB/jet-tactics', sourceType: 'editions', sourceId: id, capturedAt, sourceCommit }
  };
}

export function normalizeTeam(raw: Raw, capturedAt: string, sourceCommit?: string): JetTeamDef {
  const id = str(pick(raw, ['id', 'key', 'teamId'])) ?? 'UNKNOWN';
  return {
    id,
    name: str(pick(raw, ['name', 'nome', 'label'])) ?? id,
    color: str(pick(raw, ['color', 'cor'])),
    provenance: { sourceRepository: 'RocksXB/jet-tactics', sourceType: 'agents', sourceId: id, capturedAt, sourceCommit }
  };
}

/** Assembles a snapshot from raw captures (files may be empty when repo data is pending). */
export function buildSnapshot(
  input: {
    capturedAt: string;
    sourceCommit?: string;
    setName: string;
    agents?: Raw[];
    kits?: Raw[];
    editions?: Raw[];
    teams?: Raw[];
  }
): JetSnapshot {
  return {
    version: 1,
    setName: input.setName,
    sourceCommit: input.sourceCommit,
    capturedAt: input.capturedAt,
    teams: (input.teams ?? []).map((t) => normalizeTeam(t, input.capturedAt, input.sourceCommit)),
    editions: (input.editions ?? []).map((e) => normalizeEdition(e, input.capturedAt, input.sourceCommit)),
    agents: (input.agents ?? []).map((a) => normalizeAgent(a, input.capturedAt, input.sourceCommit)),
    kits: (input.kits ?? []).map((k) => normalizeKit(k, input.capturedAt, input.sourceCommit))
  };
}
