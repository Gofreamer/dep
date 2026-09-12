import { registry } from '../../engine/registry';
import type { CardDef, CharacterDef } from '../../engine/types';

/**
 * MÉTRICAS CLARAS DE CONTEÚDO (Fase 1) — separa o JET production pack das
 * fixtures NEXO/test/dev. Os números do relatório final derivam DAQUI: nunca
 * conte fixtures como conteúdo JET.
 *
 * Convenção de prefixos:
 *   - JET production: agent-, jres-, jact-, jeq-, jfd-, jsyn-
 *   - Fixture (NEXO/legacy): char-, res-, act-, fd-, eq-
 */

export const JET_CARD_PREFIXES = ['agent-', 'jres-', 'jact-', 'jeq-', 'jfd-', 'jsyn-'] as const;
export const FIXTURE_CARD_PREFIXES = ['char-', 'res-', 'act-', 'fd-', 'eq-'] as const;

export function isJetCard(def: CardDef): boolean {
  return JET_CARD_PREFIXES.some((p) => def.id.startsWith(p));
}

export function isFixtureCard(def: CardDef): boolean {
  return FIXTURE_CARD_PREFIXES.some((p) => def.id.startsWith(p));
}

export interface JetPackCounts {
  total: number;
  agents: number;
  /** Variantes de edição (agent-*-base é BASE; as demais são edições). */
  editions: number;
  energy: number;
  techniques: number;
  equipment: number;
  fields: number;
  team: number;
  /** Identidades de agente distintas (identityId) — nunca vira contagem de cartas. */
  agentIdentities: number;
}

export function jetPackCounts(): JetPackCounts {
  const cards = registry.allCards().filter(isJetCard);
  const agentCards = cards.filter((d) => d.kind === 'CHARACTER');
  const identities = new Set<string>();
  let editions = 0;
  for (const d of agentCards) {
    const cd = d as CharacterDef;
    if (cd.identityId) identities.add(cd.identityId);
    if ((cd.edition ?? 'BASE') !== 'BASE') editions++;
  }
  const countKind = (kind: CardDef['kind']) => cards.filter((d) => d.kind === kind).length;
  return {
    total: cards.length,
    agents: agentCards.filter((d) => (d as CharacterDef).edition === undefined || (d as CharacterDef).edition === 'BASE').length,
    editions,
    energy: countKind('RESOURCE'),
    techniques: countKind('ACTION') - cards.filter((d) => d.id.startsWith('jsyn-') && d.kind === 'ACTION').length,
    equipment: countKind('EQUIPMENT'),
    fields: countKind('FIELD'),
    team: cards.filter((d) => d.id.startsWith('jsyn-')).length,
    agentIdentities: identities.size
  };
}

export interface RegistryReport {
  jet: JetPackCounts;
  jetTotal: number;
  fixtureTotal: number;
  otherTotal: number;
  totalRegistered: number;
}

/** Relatório agregado do registry (JET real × fixtures × total em teste). */
export function registryReport(): RegistryReport {
  const all = registry.allCards();
  const jet = all.filter(isJetCard);
  const fixture = all.filter(isFixtureCard);
  const other = all.filter((d) => !isJetCard(d) && !isFixtureCard(d));
  return {
    jet: jetPackCounts(),
    jetTotal: jet.length,
    fixtureTotal: fixture.length,
    otherTotal: other.length,
    totalRegistered: all.length
  };
}

/** Relatório em texto (usado no meta-sim e nos relatórios finais). */
export function registryReportText(): string {
  const r = registryReport();
  const j = r.jet;
  const lines = [
    '===== REGISTRY REPORT =====',
    `JET CardDefs reais: ${r.jetTotal}`,
    `  Agentes BASE: ${j.agents}`,
    `  Edições (variantes): ${j.editions}`,
    `  Energia: ${j.energy}`,
    `  Técnicas: ${j.techniques}`,
    `  Equipamentos: ${j.equipment}`,
    `  Campos: ${j.fields}`,
    `  Equipe/sinergia: ${j.team}`,
    `  Identidades de agente: ${j.agentIdentities}`,
    `Fixture/test CardDefs: ${r.fixtureTotal}`,
    `Outros CardDefs: ${r.otherTotal}`,
    `Total registry em teste: ${r.totalRegistered}`
  ];
  return lines.join('\n');
}
