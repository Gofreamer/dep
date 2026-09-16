/**
 * Engine genérico — Tipos centrais (Commands, MatchState, CardDef, configs).
 *
 * The engine is fully generic: it speaks about Characters, Resources,
 * Upgrades, Abilities, Actions, Equipment, Fields, Statuses, Factions and
 * Victory Points. No theme-specific terminology is allowed here.
 * Display names come from the terminology configuration (see src/data).
 */

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export type PlayerId = 0 | 1;

/** Internal, engine-level card categories. Display names are configurable. */
export type CardKind = 'CHARACTER' | 'RESOURCE' | 'ACTION' | 'EQUIPMENT' | 'FIELD';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type AiLevel = 'easy' | 'normal' | 'hard' | 'elite';

// ---------------------------------------------------------------------------
// Resources / costs
// ---------------------------------------------------------------------------

/** A cost line. `type: '*'` means "any resource type" (generic cost). */
export interface ResourceCostEntry { type: string; amount: number }
export type ResourceCost = ResourceCostEntry[];

// ---------------------------------------------------------------------------
// Targeting (data-driven)
// ---------------------------------------------------------------------------

export type SelectorId =
  | 'self'
  | 'activeAlly'
  | 'benchAlly'
  | 'anyAlly'
  | 'enemyActive'
  | 'enemyBench'
  | 'anyEnemy'
  | 'anyCharacter'
  | 'allAllies'
  | 'allEnemies'
  | 'allCharacters'
  | 'attacker'
  | 'defender'
  | 'lastTarget';

/** Valores válidos de SelectorId em runtime (validação estrutural de dados). */
export const SELECTOR_IDS: SelectorId[] = ['self', 'activeAlly', 'benchAlly', 'anyAlly', 'enemyActive', 'enemyBench', 'anyEnemy', 'anyCharacter', 'allAllies', 'allEnemies', 'allCharacters', 'attacker', 'defender', 'lastTarget'];

export interface TargetFilterSpec {
  kinds?: CardKind[];
  factions?: string[];
  affinities?: string[];
  families?: string[];
  tags?: string[];
  maxHpAtMost?: number;
  damageAtLeast?: number;
  hasStatus?: string;
  lacksStatus?: string;
  hasCounter?: string;
  stageLevel?: number;
  hasAttachedType?: string;
  isUnique?: boolean;
  notSource?: boolean;
}

export interface TargetSpec {
  selector: SelectorId;
  /** How many targets. Default 1. 'all' ignores count. */
  count?: number | 'all';
  optional?: boolean;
  filter?: TargetFilterSpec;
  prompt?: string;
}

// ---------------------------------------------------------------------------
// Conditions (data-driven predicates)
// ---------------------------------------------------------------------------

export type ConditionSpec =
  | { op: 'always' }
  | { op: 'never' }
  | { op: 'coinFlip'; chance: number }
  | { op: 'hasStatus' | 'hadStatus'; status: string; target?: SelectorId }
  | { op: 'damageAtLeast'; value: number; target?: SelectorId }
  | { op: 'counterAtLeast'; counter: string; value: number; target?: SelectorId }
  | { op: 'discardAtLeast'; count: number; side?: 'source' | 'opponent' }
  | { op: 'benchAtLeast'; value: number; side?: 'source' | 'opponent' }
  | { op: 'benchAtMost'; value: number; side?: 'source' | 'opponent' }
  | { op: 'deckAtLeast'; count: number; side?: 'source' | 'opponent' }
  | { op: 'turnAtLeast'; turn: number }
  | { op: 'vpCompare'; side?: 'source' | 'opponent'; compare: 'more' | 'less' | 'equal' }
  | { op: 'factionInPlay'; faction: string; side?: 'source' | 'opponent' | 'any' }
  | { op: 'attachedType'; resourceType: string; target?: SelectorId }
  | { op: 'enemyActiveHasCostAtLeast'; amount: number }
  | { op: 'and'; of: ConditionSpec[] }
  | { op: 'or'; of: ConditionSpec[] }
  | { op: 'not'; of: ConditionSpec };

// ---------------------------------------------------------------------------
// Effects (data-driven steps resolved by the effect engine)
// ---------------------------------------------------------------------------

/**
 * A single step of an effect chain. `op` names a primitive registered in the
 * effect registry; all other keys are parameters of that primitive.
 * Effects are declared in card data — cards never ship custom engine code.
 */
export interface EffectStep {
  op: string;
  [param: string]: unknown;
}

/** Scaling formula for attacks. */
export interface ScalingSpec {
  per: 'attachedResource' | 'attachedResourceType' | 'selfDamage' | 'counter' | 'discardCount' | 'benchCount' | 'turnNumber' | 'resourcesInPlay';
  type?: string;
  counter?: string;
  amount: number;
  cap?: number;
}

// ---------------------------------------------------------------------------
// Stat modifiers (used by Equipment, Fields, passive abilities, temp effects)
// ---------------------------------------------------------------------------

export interface Mods {
  damageDealtFlat?: number;
  damageDealtMult?: number;
  damageDealtVsAffinity?: { affinity: string; flat?: number; mult?: number };
  damageTakenFlat?: number;
  damageTakenMult?: number;
  damageTakenFromAffinity?: { affinity: string; flat?: number; mult?: number };
  attackCostReduce?: number;
  retreatCostMod?: number;
  cannotAttack?: boolean;
  cannotRetreat?: boolean;
  abilitiesDisabled?: boolean;
  healFlat?: number;
  drawExtra?: number;
  attachExtra?: number;
  statusImmune?: string[];
  resistAll?: number;
  statBonusHp?: number;
  vpBonus?: number;
}

/** High-impact, temporary battlefield overrides (Domain-like hook). */
export interface BattlefieldOverride {
  blockSwitching?: boolean;
  blockRetreat?: boolean;
  disableAbilities?: boolean;
  attackCostMod?: number;
  retreatCostMod?: number;
  attachExtra?: number;
  damageMultAll?: number;
  durationTurns?: number;
}

// ---------------------------------------------------------------------------
// Abilities & triggers
// ---------------------------------------------------------------------------

export type TriggerEvent =
  | 'onPlay'
  | 'onUpgrade'
  | 'turnStart'
  | 'turnEnd'
  | 'beforeAttack'
  | 'afterAttack'
  | 'onDamaged'
  | 'onHealed'
  | 'onResourceAttached'
  | 'onAllyEnter'
  | 'onAllyDefeated'
  | 'onEnemyDefeated'
  | 'onLeavePlay'
  | 'whileActive'
  | 'whileBench'
  | 'activated';

export interface AbilityDef {
  id: string;
  name: string;
  text?: string;
  trigger: TriggerEvent;
  /** Passive aura abilities (whileActive/whileBench) carry `mods`. */
  mods?: Mods;
  cost?: ResourceCost;
  effects?: EffectStep[];
  oncePerTurn?: boolean;
  oncePerMatch?: boolean;
  condition?: ConditionSpec;
  zone?: 'active' | 'bench' | 'any';
  /** True when the ability requires the opponent to choose targets. */
  opponentChooses?: boolean;
  /** Ver `AttackDef.costReduceImmune` — custo de habilidade imune a desconto. */
  costReduceImmune?: boolean;
}

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------

export interface AttackDef {
  /**
   * Slot canônico do kit na fonte (Jet Tactics): 'skill' ou 'signature'.
   * Edições especiais substituem EXATAMENTE o slot declarado aqui — nunca
   * infira o slot pelo custo de energia.
   */
  role?: 'skill' | 'signature';
  id: string;
  name: string;
  text?: string;
  cost: ResourceCost;
  /** Flat base damage; omit for utility attacks. */
  damage?: number;
  scaling?: ScalingSpec[];
  target?: TargetSpec;
  effectsBefore?: EffectStep[];
  effects?: EffectStep[];
  selfDamage?: number;
  affinity?: string;
  anim?: string;
  tags?: string[];
  ignoreWeakness?: boolean;
  ignoreResistance?: boolean;
  /**
   * Finishers de 4–5E: nenhum redutor de custo (`attackCostReduce`) se aplica a
   * este ataque. O payoff do jogo tardio não pode ser comprado com desconto.
   */
  costReduceImmune?: boolean;
  condition?: ConditionSpec;
}

// ---------------------------------------------------------------------------
// Card definitions (static data)
// ---------------------------------------------------------------------------

/** Procedural placeholder art. Replaced by real artwork later via `artRef`. */
export interface ArtSpec {
  motif: string;      // glyph motif key for the procedural art
  seed: string;       // deterministic variation
  artRef?: string;    // future: path/URL of real artwork
}

export interface CardBase {
  id: string;
  kind: CardKind;
  name: string;
  text?: string;
  faction: string;
  affinity?: string;
  rarity: Rarity;
  tags: string[];
  art: ArtSpec;
  flavor?: string;
  number?: number;
  unique?: boolean;
  /**
   * Character identity across editions/variants (e.g. agent-jenny for
   * Jenny BASE and Jenny MVP). Deck identity limits key off this.
   */
  identityId?: string;
  /** Collectible variant/edition label (BASE, MVP, CHAMPION…). NOT a stage. */
  edition?: string;
  /** Foil/holo print — purely cosmetic, never affects stats. */
  holo?: boolean;
}

export interface CharacterDef extends CardBase {
  kind: 'CHARACTER';
  maxHp: number;
  /** Index into config.progression.stages. */
  stage: number;
  family?: string;
  /** Character ids this one may upgrade into (alternate paths allowed). */
  upgradesTo?: string[];
  retreatCost: number;
  weakness?: { affinity: string };
  resistance?: { affinity: string; reduce?: number };
  abilities: AbilityDef[];
  attacks: AttackDef[];
  /** Victory points awarded when this character is defeated. */
  victoryValue: number;
  equipmentSlots?: number;
  /**
   * Optional Suprema — a once-per-match power the engine can activate when its
   * condition and cost are satisfied. Purely data-driven; most agents have none.
   */
  ultimate?: UltimateDef;
}

/** Optional, generic Suprema structure (future-proof; not required on agents). */
export interface UltimateDef {
  id: string;
  name: string;
  text?: string;
  /** Must evaluate true before activation (energy, counters, discard size…). */
  activationCondition?: ConditionSpec;
  cost?: ResourceCost;
  effects: EffectStep[];
  /** Always enforced by the engine, kept explicit for readability. */
  oncePerMatch?: true;
  /** Ver `AttackDef.costReduceImmune` — custo da Suprema imune a desconto. */
  costReduceImmune?: boolean;
}

export interface ResourceDef extends CardBase {
  kind: 'RESOURCE';
  /** Resource type id it provides ('*' providers are wild). */
  resourceType: string;
  amount: number;
  wild?: boolean;
  /** Temporary resources are discarded when used to pay costs. */
  temporary?: boolean;
  onAttach?: EffectStep[];
  mods?: Mods;
}

export interface RestrictionSpec {
  type: 'oncePerTurn' | 'whileLosing' | 'factionInPlay' | 'characterCondition' | 'turnAtLeast';
  faction?: string;
  turn?: number;
  condition?: ConditionSpec;
  text?: string;
}

export interface ActionDef extends CardBase {
  kind: 'ACTION';
  effects: EffectStep[];
  restrictions?: RestrictionSpec[];
}

export interface EquipmentDef extends CardBase {
  kind: 'EQUIPMENT';
  mods?: Mods;
  triggers?: AbilityDef[];
  grantsAttacks?: AttackDef[];
}

export interface FieldDef extends CardBase {
  kind: 'FIELD';
  /** ARENA = standard field; EVENT = one-shot-ish; DOMAIN = Expansão de Domínio (battlefield override). */
  subtype?: 'ARENA' | 'EVENT' | 'DOMAIN';
  mods?: Mods;
  triggers?: AbilityDef[];
  onPlay?: EffectStep[];
  override?: BattlefieldOverride;
  /** Affected side: 'all' (default) or owner only. */
  scope?: 'all' | 'owner';
}

export type CardDef = CharacterDef | ResourceDef | ActionDef | EquipmentDef | FieldDef;

// ---------------------------------------------------------------------------
// Status effects (structured, data-driven)
// ---------------------------------------------------------------------------

export interface StatusDef {
  id: string;
  kind: 'debuff' | 'buff';
  /** When tokens are consumed. */
  timing: 'turnEndOwner' | 'turnStartOwner' | 'attackResolved';
  stacking: 'refresh' | 'stack' | 'unique';
  blocksAttack?: boolean;
  blocksAbilities?: boolean;
  blocksRetreat?: boolean;
  damagePerTick?: number;
  healPerTick?: number;/**
   * Convenção de modificadores de status (única em todo o engine):
   *  - damageTakenFlat > 0 → REDUZ o dano recebido (buff, ex.: tenacity/shield).
   *  - damageTakenBonusFlat > 0 → AUMENTA o dano recebido (debuff, ex.: marked).
   * Ambos se aplicam a dano de QUALQUER fonte (ataque ou efeito) e são
   * aplicados em applyDamage — nunca duplo-contados.
   */
  damageTakenBonusFlat?: number;
  /** > 0: reduz o dano recebido por stack (buff — ex.: tenacity 20, shield 30). */
  damageTakenFlat?: number;
  /** Wake/shed chance on each timing tick (0..1). */
  shedChance?: number;
  visual: string;
  text: string;
}

export interface StatusInstance {
  id: string;
  tokens: number;
  stacks: number;
  sinceTurn: number;
}

// ---------------------------------------------------------------------------
// Runtime card instances
// ---------------------------------------------------------------------------

export interface CardInstance {
  uid: string;
  defId: string;
  owner: PlayerId;
  kind: CardKind;
  /** Character runtime — damage persists until healed. */
  damage: number;
  /** Current progression index (mirrors the top of `progression` after upgrades). */
  stageLevel: number;
  statuses: StatusInstance[];
  counters: Record<string, number>;
  /** Attached Resource and Equipment instances. */
  attached: CardInstance[];
  /**
   * Real progression stack (Base → Upgrade 1 → …). Entries are the ACTUAL card
   * instances that left the hand — never copies. `defId` of the instance stays
   * the Base card; the effective definition is the top of this stack.
   */
  progression: CardInstance[];
  /** Once-per-turn keys already used this turn (reset each turn). */
  usedTurn: string[];
  /** Once-per-match keys already used. */
  usedMatch: string[];
  deployedOnTurn: number;
  faceDown?: boolean;
  /**
   * True for temporary tokens/materializations created by effects (never from a
   * real card). Generated instances are not conserved: they vanish instead of
   * going to the discard pile.
   */
  generated?: boolean;
}

export type Zone = 'deck' | 'hand' | 'active' | 'bench' | 'discard';

// ---------------------------------------------------------------------------
// Match / player state (JSON-serializable — safe for replays & netcode later)
// ---------------------------------------------------------------------------

export interface PlayerState {
  index: PlayerId;
  name: string;
  isAI: boolean;
  aiLevel: AiLevel;
  deckId: string;
  deck: CardInstance[];
  hand: CardInstance[];
  active: CardInstance | null;
  bench: CardInstance[];
  discard: CardInstance[];
  victoryPoints: number;
  attachedThisTurn: number;
  retreatedThisTurn: number;
  actionsPlayedTurn: string[];
  setupDone: boolean;
}

export type Phase = 'setup' | 'main' | 'gameOver';

export interface TempMod {
  id: string;
  sourceUid?: string;
  owner: PlayerId;
  mods: Mods;
  /** 'nextAttack' expires after the next attack resolution. */
  scope: 'nextAttack' | 'thisTurn' | 'nextTurn' | 'permanent';
  targetUid?: string;
  label?: string;
}

export interface TriggerTask {
  event: string;
  sourceUid: string;
  hostUid?: string;
  player: PlayerId;
  payload?: Record<string, unknown>;
}

export interface MatchState {
  id: string;
  seed: number;
  rngState: number;
  turn: number;
  activePlayer: PlayerId;
  startingPlayer: PlayerId;
  phase: Phase;
  /** Engine configuration snapshot (limits, progression, victory rules). */
  config: GameConfig;
  players: [PlayerState, PlayerState];
  /** Global field cards in play (limit configurable). */
  fields: CardInstance[];
  /** Active battlefield overrides (Domain-like hook), flattened for fast queries. */
  fieldOverrides: {
    id: string;
    sourceUid: string;
    owner: PlayerId;
    override: BattlefieldOverride;
    expiresTurn?: number;
    blockSwitching?: boolean;
    blockRetreat?: boolean;
    disableAbilities?: boolean;
    attackCostMod?: number;
    retreatCostMod?: number;
    attachExtra?: number;
    damageMultAll?: number;
  }[];
  tempMods: TempMod[];
  log: GameEvent[];
  eventSeq: number;
  /** Monotonic counter for runtime card instance uids. */
  nextUid: number;
  /** Pending trigger tasks (serializable), drained by the engine. */
  triggerQueue: TriggerTask[];
  winner: PlayerId | 'draw' | null;
  endReason: string | null;
  /** Effects currently resolving (for UI display). */
  resolvingCardUid: string | null;
  lastAttack: { attackerUid: string; attackId: string; damage: number; targetUids: string[] } | null;
  stats: { damage: [number, number]; healed: [number, number]; cardsDrawn: [number, number] };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type GameEventType =
  | 'MATCH_STARTED'
  | 'TURN_STARTED'
  | 'TURN_ENDED'
  | 'PHASE_CHANGED'
  | 'CARD_DRAWN'
  | 'CARD_PLAYED'
  | 'CARD_DISCARDED'
  | 'CHARACTER_DEPLOYED'
  | 'ACTIVE_SET'
  | 'RESOURCE_ATTACHED'
  | 'RESOURCE_DETACHED'
  | 'CHARACTER_UPGRADED'
  | 'ABILITY_ACTIVATED'
  | 'ATTACK_USED'
  | 'DAMAGE_DEALT'
  | 'HEALED'
  | 'STATUS_APPLIED'
  | 'STATUS_REMOVED'
  | 'STATUS_TICKED'
  | 'CHARACTER_DEFEATED'
  | 'ACTIVE_SWITCHED'
  | 'FIELD_PLAYED'
  | 'FIELD_REPLACED'
  | 'EQUIPMENT_PLAYED'
  | 'ACTION_PLAYED'
  | 'CARD_MOVED'
  | 'COIN_FLIPPED'
  | 'COUNTER_ADDED'
  | 'VICTORY_POINTS_CHANGED'
  | 'CHOICE_REQUESTED'
  | 'MATCH_ENDED';

export interface GameEvent {
  seq: number;
  turn: number;
  player: PlayerId | null;
  type: GameEventType;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Commands (UI/AI → engine)
// ---------------------------------------------------------------------------

export type Command =
  | { type: 'SETUP_SET_ACTIVE'; player: PlayerId; uid: string }
  | { type: 'SETUP_BENCH'; player: PlayerId; uid: string }
  | { type: 'SETUP_DONE'; player: PlayerId }
  | { type: 'DEPLOY_CHARACTER'; player: PlayerId; uid: string }
  | { type: 'ATTACH_RESOURCE'; player: PlayerId; uid: string; targetUid: string }
  | { type: 'UPGRADE'; player: PlayerId; uid: string; targetUid: string }
  | { type: 'PLAY_ACTION'; player: PlayerId; uid: string; targetUids?: string[] }
  | { type: 'PLAY_EQUIPMENT'; player: PlayerId; uid: string; targetUid: string }
  | { type: 'PLAY_FIELD'; player: PlayerId; uid: string }
  | { type: 'USE_ABILITY'; player: PlayerId; charUid: string; abilityId: string; targetUids?: string[] }
  | { type: 'USE_ULTIMATE'; player: PlayerId; charUid: string; ultimateId: string; targetUids?: string[] }
  | { type: 'ATTACK'; player: PlayerId; attackId: string }
  | { type: 'RETREAT'; player: PlayerId; benchUid: string }
  | { type: 'END_TURN'; player: PlayerId }
  | { type: 'RESOLVE_CHOICE'; player: PlayerId; selected: string[] }
  | { type: 'CONCEDE'; player: PlayerId };

export interface CommandResult {
  ok: boolean;
  error?: string;
  events: GameEvent[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BoardConfig {
  benchSize: number;
  fieldSlots: number;
  equipmentSlotsDefault: number;
}

export interface TurnConfig {
  /** Ordered steps executed for every turn. */
  steps: string[];
  startingPlayerSkipsAttack?: boolean;
  drawAmount: number;
  attachPerTurn: number;
  retreatsPerTurn: number;
  attackEndsTurn: boolean;
  /**
   * Piso de Energia que sempre resta pago num custo de ataque/habilidade.
   * Redutores de custo NUNCA zera um custo não-vazio (0 = regra desligada).
   */
  attackCostFloor?: number;
  /** Máximo de pontos de redução que se aplicam a um mesmo custo (sem estouro). */
  maxAttackCostReduce?: number;
  /**
   * Regra de espécie das AÇÕES (Técnicas): cada def de ação pode ser jogada
   * UMA vez por turno. Ações não têm custo de Energia (são "grátis" por
   * design — ver `toTechnique`), então o limite por def é o único freio da
   * economia de cartas; sem ele, N cópias da mesma técnica viram N× o efeito
   * no mesmo turno (o 2.0 só freava quem declarasse `oncePerTurn` — os
   * `jsyn-*` passavam sem limite). `false` desliga (fixtures/testes).
   */
  actionOncePerTurn?: boolean;
}

export interface SetupConfig {
  handSize: number;
  requireBasic: boolean;
  mulligan: 'auto' | 'interactive';
  mulliganBonusDraw: boolean;
  benchAtSetup: boolean;
}

export interface VictoryConfig {
  targetPoints: number;
  deckOutLoses: boolean;
  noActiveLoses: boolean;
}

export interface DamageConfig {
  weaknessMultiplier: number;
  resistanceDefaultReduce: number;
}

export interface DeckRulesConfig {
  min: number;
  max: number;
  /** Max copies per card definition (maxCopiesPerCard). */
  maxCopies: number;
  /**
   * Max copies counted across ALL variants/editions of the same identityId
   * (e.g. Jenny BASE + Jenny MVP together). Undefined = unlimited.
   */
  maxCopiesPerIdentity?: number;
  uniqueMax: number;
  allowMultipleFactions: boolean;
  /** Card kinds exempt from the per-card copy limit (e.g. resources). */
  copyLimitExempt?: CardKind[];
}

export interface ProgressionConfig {
  /** Stage labels come from configuration, never hardcoded. */
  stages: string[];
  canSkipStages: boolean;
  damageCarriesOver: boolean;
  keepAttachedOnUpgrade: boolean;
}

export interface GameConfig {
  board: BoardConfig;
  turn: TurnConfig;
  setup: SetupConfig;
  victory: VictoryConfig;
  damage: DamageConfig;
  deckRules: DeckRulesConfig;
  progression: ProgressionConfig;
  /** Type ring used for weakness preview hints (optional). */
  defaultVictoryValue?: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  board: { benchSize: 5, fieldSlots: 1, equipmentSlotsDefault: 2 },
  turn: {
    steps: ['start', 'draw', 'main', 'end'],
    startingPlayerSkipsAttack: true,
    drawAmount: 1,
    attachPerTurn: 1,
    retreatsPerTurn: 1,
    attackEndsTurn: true,
    attackCostFloor: 1,
    maxAttackCostReduce: 1,
    actionOncePerTurn: true
  },
  setup: { handSize: 7, requireBasic: true, mulligan: 'auto', mulliganBonusDraw: true, benchAtSetup: true },
  victory: { targetPoints: 4, deckOutLoses: true, noActiveLoses: true },
  damage: { weaknessMultiplier: 2, resistanceDefaultReduce: 30 },
  // `maxCopiesPerIdentity` é o limite SOMANDO edições/variantes do mesmo agente
  // (base + MVP + CHAMPION…). `validateDeck` já implementa a regra e o builder
  // da UI já a consultava, mas o campo faltava aqui → a regra estava morta.
  deckRules: { min: 40, max: 60, maxCopies: 4, maxCopiesPerIdentity: 4, uniqueMax: 1, allowMultipleFactions: true, copyLimitExempt: ['RESOURCE'] },
  progression: { stages: ['Base', 'Estágio 1', 'Estágio 2'], canSkipStages: false, damageCarriesOver: true, keepAttachedOnUpgrade: true }
};

// ---------------------------------------------------------------------------
// Targeting / choice requests (engine ⇄ UI contract)
// ---------------------------------------------------------------------------

export interface ChoiceRequest {
  kind: 'target' | 'cards' | 'option';
  player: PlayerId;
  prompt: string;
  /** Card instance uids valid as an answer (targets / cards / option ids). */
  candidates: string[];
  min: number;
  max: number;
  optional: boolean;
  /** Display info for candidates: uid → label. */
  labels?: Record<string, string>;
}

export interface ChoiceValue { selected: string[] }

export interface LegalActions {
  version: number;
  /** Hand card uid → playable info. */
  hand: Record<string, { playable: boolean; reason?: string; targetMode?: 'none' | 'ally' | 'enemy' | 'any' }>;
  deployable: string[];
  upgradable: { from: string; to: string }[];
  attacks: { attackId: string; playable: boolean; reason?: string }[];
  abilities: { charUid: string; abilityId: string; playable: boolean; reason?: string }[];
  canRetreat: boolean;
  retreatTargets: string[];
  playableActions: string[];
  playableEquipment: { uid: string; targets: string[] }[];
  playableFields: string[];
  setupActive: string[];
  setupBench: string[];
  setupDone: boolean;
  /** Supremas do ativo/reserva com disponibilidade e motivo. */
  ultimates: { charUid: string; ultimateId: string; playable: boolean; reason?: string }[];
  /** Pode responder à recompra voluntária de mão (mulligan interativo). */
  mulliganChoice: { prompt: string; options: { id: string; label: string }[] } | null;
}
