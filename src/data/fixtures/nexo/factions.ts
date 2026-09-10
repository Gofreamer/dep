import { registry } from '../../../engine/registry';

/**
 * Placeholder original universe for the prototype.
 * Factions, affinities and resource types are pure data — swapping them is
 * what turns NEXO into any other universe (e.g. JET) later.
 */
export const FACTIONS = [
  { id: 'solar', name: 'Solar', color: '#f97316' },
  { id: 'mare', name: 'Maré', color: '#38bdf8' },
  { id: 'flora', name: 'Flora', color: '#4ade80' },
  { id: 'volt', name: 'Volt', color: '#facc15' },
  { id: 'umbra', name: 'Umbra', color: '#a78bfa' },
  { id: 'neutro', name: 'Neutro', color: '#94a3b8' }
] as const;

/** Affinity damage ring (weakness hints). All values configurable. */
export const AFFINITIES = [
  { id: 'solar', name: 'Solar', color: '#f97316', weaknessOf: ['flora'] },
  { id: 'mare', name: 'Maré', color: '#38bdf8', weaknessOf: ['solar'] },
  { id: 'flora', name: 'Flora', color: '#4ade80', weaknessOf: ['volt'] },
  { id: 'volt', name: 'Volt', color: '#facc15', weaknessOf: ['mare', 'umbra'] },
  { id: 'umbra', name: 'Umbra', color: '#a78bfa', weaknessOf: [] },
  { id: 'neutro', name: 'Neutro', color: '#94a3b8', weaknessOf: [] }
] as const;

export const RESOURCE_TYPES = [
  { id: 'solar', name: 'Solar', color: '#f97316' },
  { id: 'mare', name: 'Maré', color: '#38bdf8' },
  { id: 'flora', name: 'Flora', color: '#4ade80' },
  { id: 'volt', name: 'Volt', color: '#facc15' },
  { id: 'umbra', name: 'Umbra', color: '#a78bfa' },
  { id: '*', name: 'Neutro', color: '#94a3b8' }
] as const;

export function registerCosmetics(): void {
  FACTIONS.forEach((f) => registry.registerFaction({ ...f }));
  AFFINITIES.forEach((a) => registry.registerAffinity({ ...a, weaknessOf: a.weaknessOf ? [...a.weaknessOf] : undefined }));
  RESOURCE_TYPES.forEach((r) => registry.registerResourceType({ ...r }));
}
