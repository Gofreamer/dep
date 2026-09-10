import type { AbilityDef, AttackDef, CharacterDef, ConditionSpec, EffectStep, UltimateDef } from '../../engine/types';
import type { JetAgentIdentity, JetAgentKit, JetProvenance, TcgProfileStatus } from './types';

/**
 * Converter: (identity + kit + curated TCG profile) → generic engine CardDef.
 *
 * The CREATIVE conversion (Jet Tactics passiva/skill/signature → TCG
 * mechanics, respecting role identity) lives in curated data
 * (`src/data/jet/agentProfiles.ts`) — reviewed, versionable, data-only.
 * The converter is purely mechanical: it assembles the CharacterDef,
 * guarantees invariants and stamps provenance/identity metadata.
 */

/** One curated TCG adaptation of an agent edition. */
export interface AgentTcgProfile {
  agentId: string;
  edition: string;                       // 'BASE' | 'MVP' | …
  status: TcgProfileStatus;
  /** Free-form note for pending/adaptation choices (documentation, not lore). */
  adaptationNote?: string;
  cardId: string;                        // 'agent-jenny-base'
  name: string;                          // display name ('Jenny' / 'Jenny MVP')
  faction: string;                       // team-derived
  affinity?: string;
  rarity: CharacterDef['rarity'];
  holo?: boolean;                        // cosmetic only — never stats
  maxHp: number;
  retreatCost: number;
  weakness?: { affinity: string };
  resistance?: { affinity: string; reduce?: number };
  abilities: AbilityDef[];
  attacks: AttackDef[];
  /** Only when the source explicitly marks a Suprema. */
  ultimate?: UltimateDef;
  /** Transformação real (Base → Forma → Despertar) — nunca derivada de edição. */
  upgradesTo?: string[];
  stage?: number;
  victoryValue: number;
  tags?: string[];
  flavor?: string;
  provenance: JetProvenance;
}

export interface ConvertedAgent {
  def: CharacterDef;
  status: TcgProfileStatus;
  identity: JetAgentIdentity;
  kit?: JetAgentKit;
}

/**
 * Builds one playable CharacterDef from a curated profile.
 * Edição NUNCA vira estágio: toda carta curada é stage 0 salvo transformação
 * explícita declarada no próprio profile (`stage`/`upgradesTo`).
 */
export function convertAgent(profile: AgentTcgProfile, identity: JetAgentIdentity, kit?: JetAgentKit): ConvertedAgent {
  const def: CharacterDef = {
    id: profile.cardId,
    kind: 'CHARACTER',
    name: profile.name,
    text: kit?.summary ?? identity.description,
    flavor: profile.flavor,
    faction: profile.faction,
    affinity: profile.affinity,
    rarity: profile.rarity,
    holo: profile.holo,
    tags: [...(profile.tags ?? [])],
    art: {
      motif: identity.team ?? 'jet',
      seed: profile.cardId,
      // official artwork reference when the source publishes one (Parte 20)
      artRef: identity.imageUrl
    },
    identityId: identity.agentId,
    edition: profile.edition,
    maxHp: Math.max(10, profile.maxHp),
    stage: profile.stage ?? 0,
    upgradesTo: profile.upgradesTo,
    retreatCost: Math.max(0, profile.retreatCost),
    weakness: profile.weakness,
    resistance: profile.resistance,
    abilities: profile.abilities,
    attacks: profile.attacks,
    ultimate: profile.ultimate,
    victoryValue: Math.max(1, profile.victoryValue)
  };
  const out = { def, status: profile.status, identity, kit };
  // provenance travels as a non-enumerable extra (JSON-safe, out of gameplay code)
  (def as any).provenance = profile.provenance;
  return out;
}

/**
 * Pending editions produce NO playable card (no invented canon). They are
 * listed by the importer for the catalog "aguardando adaptação" section.
 */
export function pendingProfile(identity: JetAgentIdentity, edition: string): AgentTcgProfile {
  return {
    agentId: identity.agentId,
    edition,
    status: 'TCG_PROFILE_PENDING',
    adaptationNote: 'Aguardando adaptação — edição oficial ainda sem perfil TCG curado.',
    cardId: `${identity.agentId}-${edition.toLowerCase()}`,
    name: edition === 'BASE' ? identity.name : `${identity.name} ${edition}`,
    faction: identity.team ?? 'neutro',
    rarity: 'common',
    maxHp: 0, // zero = não jogável (nunca registrado)
    retreatCost: 0,
    abilities: [],
    attacks: [],
    victoryValue: 0,
    provenance: identity.provenance
  };
}

// Profile-authoring helpers (used by src/data/jet/agentProfiles.ts) ----------

export function mkAttack(
  id: string, name: string, cost: [string, number][], damage: number | undefined,
  extra: Partial<AttackDef> = {}
): AttackDef {
  return { id, name, cost: cost.map(([type, amount]) => ({ type, amount })), damage, ...extra };
}

export function mkAbility(
  id: string, name: string, trigger: AbilityDef['trigger'], extra: Partial<AbilityDef> = {}
): AbilityDef {
  return { id, name, trigger, ...extra };
}

export function mkEffect(op: string, params: Record<string, unknown> = {}): EffectStep {
  return { op, ...params };
}

export function mkCondition(cond: ConditionSpec): ConditionSpec {
  return cond;
}
