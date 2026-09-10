import { registry } from '../../engine/registry';
import type { CardDef, CharacterDef } from '../../engine/types';
import type { JetAgentKit, JetEditionDef, JetSnapshot, JetTeamDef } from './types';
import { convertAgent, pendingProfile, type AgentTcgProfile, type ConvertedAgent } from './converter';

/**
 * Importer: snapshot + curated profiles → registered engine data.
 *
 * Rules enforced here (product spec Partes 5, 8, 9, 16, 36):
 *  - only OFFICIAL identities/editions enter the registry;
 *  - editions are variants (identityId), never stages/evolutions;
 *  - pending editions are NOT registered as playable cards — they surface in
 *    the catalog as "aguardando adaptação" (TCG_PROFILE_PENDING);
 *  - teams become factions only with official data;
 *  - no credentials/secrets/URLs autenticadas are ever imported.
 */

export interface ImportReport {
  teamsRegistered: string[];
  editionsRegistered: string[];
  agentsRegistered: ConvertedAgent[];
  pending: { agentId: string; name: string; edition: string }[];
  skipped: { agentId: string; reason: string }[];
}

export interface ImportOptions {
  /** Curated TCG profiles keyed by `${agentId}#${edition}`. */
  profiles: Record<string, AgentTcgProfile>;
  /** Register teams as playable factions (default true). */
  registerTeamsAsFactions?: boolean;
  /** Register editions into the registry bookkeeping (default true). */
  registerEditions?: boolean;
}

export function profileKey(agentId: string, edition: string): string {
  return `${agentId}#${edition}`;
}

export function importSnapshot(snapshot: JetSnapshot, opts: ImportOptions): ImportReport {
  const report: ImportReport = { teamsRegistered: [], editionsRegistered: [], agentsRegistered: [], pending: [], skipped: [] };
  const registerTeams = opts.registerTeamsAsFactions ?? true;
  const registerEds = opts.registerEditions ?? true;

  // Teams → factions (official data only)
  if (registerTeams) {
    for (const team of snapshot.teams) {
      if (registry.faction(team.id)) continue;
      registry.registerFaction({ id: team.id, name: team.name, color: team.color ?? '#d4af37' });
      report.teamsRegistered.push(team.id);
    }
  }

  // Editions (bookkeeping for the catalog)
  if (registerEds) {
    for (const ed of snapshot.editions) {
      if (!report.editionsRegistered.includes(ed.id)) report.editionsRegistered.push(ed.id);
    }
  }

  // Agents → cards
  for (const identity of snapshot.agents) {
    if (!identity.editions.length) {
      report.skipped.push({ agentId: identity.agentId, reason: 'sem edições oficiais na fonte' });
      continue;
    }
    for (const edition of identity.editions) {
      const profile = opts.profiles[profileKey(identity.agentId, edition)];
      if (!profile || profile.status === 'TCG_PROFILE_PENDING' || profile.maxHp <= 0) {
        report.pending.push({ agentId: identity.agentId, name: identity.name, edition });
        continue;
      }
      if (registry.tryCard(profile.cardId)) continue; // idempotent
      const kit = snapshot.kits.find((k) => k.agentId === identity.agentId && (k.edition ?? 'BASE') === edition);
      const converted = convertAgent(profile, identity, kit);
      registry.registerCard(converted.def as unknown as CardDef);
      report.agentsRegistered.push(converted);
    }
  }
  return report;
}

/** Catalog entries for pending editions (UI "aguardando adaptação"). */
export function pendingCatalog(snapshot: JetSnapshot, profiles: Record<string, AgentTcgProfile>): { agentId: string; name: string; edition: string; note: string }[] {
  const out: { agentId: string; name: string; edition: string; note: string }[] = [];
  for (const identity of snapshot.agents) {
    for (const edition of identity.editions) {
      const profile = profiles[profileKey(identity.agentId, edition)];
      if (!profile || profile.status === 'TCG_PROFILE_PENDING' || profile.maxHp <= 0) {
        const p = pendingProfile(identity, edition);
        out.push({ agentId: identity.agentId, name: identity.name, edition, note: p.adaptationNote ?? '' });
      }
    }
  }
  return out;
}

/** Faction color lookup with JET-gold fallback. */
export function factionColorOf(team: JetTeamDef | undefined): string {
  return team?.color ?? '#d4af37';
}

/** Validates a converted card against the TCG invariants before registration. */
export function assertConvertible(def: CharacterDef): void {
  if (def.edition && def.stage > 0) {
    throw new Error(`carta ${def.id}: edição nunca pode ser estágio avançado (edição ≠ evolução)`);
  }
  if (def.maxHp <= 0) throw new Error(`carta ${def.id}: maxHp deve ser positivo`);
  if (!def.attacks.length && !def.abilities.length && !def.ultimate) {
    throw new Error(`carta ${def.id}: precisa de ao menos um ataque/habilidade`);
  }
  if (def.stage > 0 && !(def.family || def.upgradesTo?.length)) {
    throw new Error(`carta ${def.id}: estágio avançado exige dados de transformação explícitos`);
  }
}
