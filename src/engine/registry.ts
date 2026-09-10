import type { CardDef, StatusDef } from './types';

/**
 * Data registry. Card definitions, statuses, factions and affinities are
 * injected as structured data — the engine never imports content directly.
 * A future theme (e.g. JET) ships a different data pack, not new engine code.
 */
class Registry {
  private cards = new Map<string, CardDef>();
  private statuses = new Map<string, StatusDef>();
  private factions = new Map<string, { id: string; name: string; color: string }>();
  private affinities = new Map<string, { id: string; name: string; color: string; weaknessOf?: string[] }>();
  private resourceTypes = new Map<string, { id: string; name: string; color: string; wild?: boolean }>();

  registerCard(def: CardDef): void {
    if (this.cards.has(def.id)) throw new Error(`Card id duplicado: ${def.id}`);
    this.cards.set(def.id, def);
  }

  registerCards(defs: CardDef[]): void {
    defs.forEach((d) => this.registerCard(d));
  }

  card(defId: string): CardDef {
    const c = this.cards.get(defId);
    if (!c) throw new Error(`Carta não registrada: ${defId}`);
    return c;
  }

  tryCard(defId: string): CardDef | undefined {
    return this.cards.get(defId);
  }

  allCards(): CardDef[] {
    return [...this.cards.values()];
  }

  registerStatus(def: StatusDef): void {
    this.statuses.set(def.id, def);
  }

  registerStatuses(defs: StatusDef[]): void {
    defs.forEach((d) => this.registerStatus(d));
  }

  status(id: string): StatusDef | undefined {
    return this.statuses.get(id);
  }

  registerFaction(f: { id: string; name: string; color: string }): void {
    this.factions.set(f.id, f);
  }

  faction(id: string): { id: string; name: string; color: string } | undefined {
    return this.factions.get(id);
  }

  allFactions() {
    return [...this.factions.values()];
  }

  registerAffinity(a: { id: string; name: string; color: string; weaknessOf?: string[] }): void {
    this.affinities.set(a.id, a);
  }

  affinity(id: string) {
    return this.affinities.get(id);
  }

  allAffinities() {
    return [...this.affinities.values()];
  }

  registerResourceType(rt: { id: string; name: string; color: string; wild?: boolean }): void {
    this.resourceTypes.set(rt.id, rt);
  }

  resourceType(id: string) {
    return this.resourceTypes.get(id);
  }

  allResourceTypes() {
    return [...this.resourceTypes.values()];
  }
}

export const registry = new Registry();
