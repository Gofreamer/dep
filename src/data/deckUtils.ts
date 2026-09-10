import { registry } from '../engine/registry';
import type { CharacterDef, DeckRulesConfig } from '../engine/types';

export interface DeckDef {
  id: string;
  name: string;
  description: string;
  cards: Record<string, number>;
}

export interface DeckValidation {
  valid: boolean;
  errors: string[];
  counts: { total: number; byKind: Record<string, number> };
}

export function expandDeck(def: DeckDef): string[] {
  const out: string[] = [];
  for (const [id, n] of Object.entries(def.cards)) {
    for (let i = 0; i < n; i++) out.push(id);
  }
  return out;
}

export function validateDeck(
  cards: Record<string, number>,
  rules: DeckRulesConfig,
  opts: { requireBasic?: boolean } = {}
): DeckValidation {
  const errors: string[] = [];
  const counts = { total: 0, byKind: {} as Record<string, number> };
  const perIdentity: Record<string, number> = {};
  let starters = 0;
  for (const [id, n] of Object.entries(cards)) {
    const def = registry.tryCard(id);
    if (!def) { errors.push(`Carta desconhecida: ${id}`); continue; }
    counts.total += n;
    counts.byKind[def.kind] = (counts.byKind[def.kind] ?? 0) + n;
    if (def.unique && n > rules.uniqueMax) errors.push(`"${def.name}" é Única (máx. ${rules.uniqueMax}).`);
    const exempt = rules.copyLimitExempt?.includes(def.kind) ?? false;
    if (!def.unique && !exempt && n > rules.maxCopies) errors.push(`"${def.name}" excede o máximo de ${rules.maxCopies} cópias.`);
    if (def.kind === 'CHARACTER') {
      if ((def as CharacterDef).stage === 0) starters += n;
      const identity = def.identityId ?? def.id;
      perIdentity[identity] = (perIdentity[identity] ?? 0) + n;
    }
  }
  if (rules.maxCopiesPerIdentity !== undefined) {
    for (const [identity, n] of Object.entries(perIdentity)) {
      if (n > rules.maxCopiesPerIdentity) {
        const label = registry.tryCard(identity)?.name ?? identity;
        errors.push(`"${label}": variantes somam ${n} cópias (máx. ${rules.maxCopiesPerIdentity} por identidade).`);
      }
    }
  }
  if (counts.total < rules.min) errors.push(`Mínimo de ${rules.min} cartas (faltam ${rules.min - counts.total}).`);
  if (counts.total > rules.max) errors.push(`Máximo de ${rules.max} cartas (excedem ${counts.total - rules.max}).`);
  if ((opts.requireBasic ?? true) && starters < 1) {
    errors.push('O baralho precisa de pelo menos 1 agente inicial (Base) para começar a partida.');
  }
  return { valid: errors.length === 0, errors, counts };
}

/** Distribution stats used by the deck builder UI. */
export function deckStats(cards: Record<string, number>) {
  const stats = {
    total: 0,
    byKind: {} as Record<string, number>,
    byFaction: {} as Record<string, number>,
    byRarity: {} as Record<string, number>,
    upgradeCurve: {} as Record<string, number>,
    resourceTypes: {} as Record<string, number>
  };
  for (const [id, n] of Object.entries(cards)) {
    const def = registry.tryCard(id);
    if (!def) continue;
    stats.total += n;
    stats.byKind[def.kind] = (stats.byKind[def.kind] ?? 0) + n;
    stats.byFaction[def.faction] = (stats.byFaction[def.faction] ?? 0) + n;
    stats.byRarity[def.rarity] = (stats.byRarity[def.rarity] ?? 0) + n;
    if (def.kind === 'CHARACTER') {
      const stage = (def as CharacterDef).stage;
      stats.upgradeCurve[stage] = (stats.upgradeCurve[stage] ?? 0) + n;
    }
    if (def.kind === 'RESOURCE') {
      const rt = (def as any).resourceType as string;
      stats.resourceTypes[rt] = (stats.resourceTypes[rt] ?? 0) + n;
    }
  }
  return stats;
}
