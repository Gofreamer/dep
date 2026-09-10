/**
 * JET integration types — the contract between the Jet Tactics source of
 * truth and the JET TCG data pack.
 *
 * Layers (see docs/JET_TACTICS_IMPORT.md):
 *   Jet Cards / Jet Tactics (upstream repos)
 *     → JetSnapshot (normalized, checked into src/data/jet/)
 *       → converter + agentProfiles (curated TCG adaptation)
 *         → engine CardDefs (generic, data-driven)
 */

// ---------------------------------------------------------------------------
// Provenance — every imported definition records where it came from
// ---------------------------------------------------------------------------

export interface JetProvenance {
  /** Repository the data was captured from. */
  sourceRepository: 'RocksXB/jet-tactics.';
  /** File/section kind inside the source repo. */
  sourceType:
    | 'CARD_SOURCE_OF_TRUTH'
    | 'jet-cards'
    | 'agents'
    | 'curated-agents'
    | 'editions'
    | 'power'
    | 'CURATED_ROSTER'
    | 'task-prompt-fallback';
  /** Precise identifier inside the source (file#key, doc heading…). */
  sourceId: string;
  /** Edition label when the record is edition-scoped. */
  sourceEdition?: string;
  /** ISO date of the capture. */
  capturedAt: string;
  /** Source git commit sha when known. */
  sourceCommit?: string;
}

// ---------------------------------------------------------------------------
// Identity vs kit vs edition
// ---------------------------------------------------------------------------

/** WHO the agent is — edition-independent. */
export interface JetAgentIdentity {
  agentId: string;            // 'agent-jenny'
  playerKey?: string;         // key used by Jet Tactics, when present
  name: string;
  /** Official team/group id from the source (never inferred from the name). */
  team?: string;
  rank?: string;
  description?: string;
  imageUrl?: string;          // official artwork reference, when published
  /** Editions that OFFICIALLY exist for this agent in the source. */
  editions: string[];
  provenance: JetProvenance;
}

/** HOW the agent plays in Jet Tactics — the competitive identity to adapt. */
export interface JetAgentKit {
  agentId: string;
  edition?: string;
  role?: string;              // Duelist | Breaker | Controller | Guardian | Support | Commander | …
  archetype?: string;
  summary?: string;
  passive?: JetAbilitySeed;   // → TCG passive Ability
  skill?: JetAbilitySeed;     // → cheap attack / activated ability / associated Técnica
  signature?: JetAbilitySeed; // → strongest attack / expensive strategic effect
  /** ONLY when the source explicitly marks a Suprema/ultimate. */
  ultimate?: JetAbilitySeed;
  stats?: Record<string, number>;
  provenance: JetProvenance;
}

export interface JetAbilitySeed {
  name: string;
  description: string;
}

/** An official collectible edition (BASE, MVP, CHAMPION, FINALS, ICON…). */
export interface JetEditionDef {
  id: string;
  name: string;
  /** How the edition differs as a SIDE GRADE, when documented upstream. */
  sidegradeIntent?: string;
  provenance: JetProvenance;
}

/** Official team/group — becomes a TCG faction when the data allows. */
export interface JetTeamDef {
  id: string;
  name: string;
  color?: string;
  provenance: JetProvenance;
}

/** Official edition sidegrade: replaces the skill or signature of one agent. */
export interface JetEditionVariant {
  agentId: string;
  playerKey: string;
  edition: string;
  /** Which kit slot this edition replaces. */
  replaces: 'skill' | 'signature';
  tradeoff: string;
  /** Slot replacement exactly as documented upstream (name + text/description). */
  action: { name: string; description?: string; text?: string; effect?: string; amount?: number; rows?: string[] };
}

/**
 * The complete normalized capture. Lives checked-in at
 * `src/data/jet/snapshot.ts` — runtime NEVER reads the upstream repository.
 */
export interface JetSnapshot {
  version: number;
  setName: string;            // e.g. 'JET CORE SET — Alpha'
  sourceCommit?: string;
  capturedAt: string;
  teams: JetTeamDef[];
  editions: JetEditionDef[];
  agents: JetAgentIdentity[];
  kits: JetAgentKit[];
  editionVariants: JetEditionVariant[];
}

/** Adaptation status of an edition → TCG card. */
export type TcgProfileStatus = 'CURATED' | 'TCG_PROFILE_PENDING';
