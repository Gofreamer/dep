import { registry } from '../../../engine/registry';
import type { CharacterDef, DeckRulesConfig } from '../../../engine/types';

export interface DeckDef {
  id: string;
  name: string;
  description: string;
  cards: Record<string, number>;
}

/**
 * Baralhos iniciais. Terminologia e conteúdo são dados — os 3 arquétipos
 * clássicos (agressivo, evolução, controle) para demonstrar a engine.
 */
export const STARTER_DECKS: DeckDef[] = [
  {
    id: 'deck-furia-solar',
    name: 'Fúria Solar',
    description: 'Agressivo: personagens rápidos, ataques baratos e pressão constante.',
    cards: {
      'char-cindro': 4, 'char-ignarok': 3, 'char-vulcannon': 2,
      'char-chispito': 3, 'char-voltraio': 2,
      'char-faiscante': 2, 'char-braseiro': 2, 'char-nimbo': 2, 'char-ciclone': 1,
      'res-solar': 8, 'res-volt': 5, 'res-neutro': 4, 'res-prisma': 2, 'res-cristal-furia': 1,
      'act-golpe': 2, 'act-furia': 3, 'act-inspiracao': 2, 'act-aceleracao': 2,
      'act-granada': 2, 'act-escudo': 2, 'act-reforcos': 2,
      'eq-lamina': 1, 'eq-foco': 1,
      'fd-arena-solar': 2
    }
  },
  {
    id: 'deck-ascensao',
    name: 'Ascensão',
    description: 'Evolução: começa devagar, mas domina o jogo com formas finais poderosas.',
    cards: {
      'char-brotinho': 3, 'char-floradon': 3, 'char-silvana': 2,
      'char-ploc': 3, 'char-marefix': 3, 'char-abissalor': 2,
      'char-vesper': 2, 'char-espectro': 2,
      'char-carvalho': 1, 'char-sementeira': 2, 'char-ondina': 1,
      'res-flora': 7, 'res-mare': 7, 'res-neutro': 3, 'res-essencia-viva': 1, 'res-nucleo-eco': 1, 'res-prisma': 1,
      'act-reforcos': 2, 'act-treinamento': 2, 'act-chamado': 1, 'act-inspiracao': 2,
      'act-estimulo': 2, 'act-balsamo': 1, 'act-soro': 1, 'act-purga': 1,
      'eq-amuleto': 1, 'eq-oraculo': 1,
      'fd-mare-alta': 1, 'fd-forja': 1
    }
  },
  {
    id: 'deck-controle-tatico',
    name: 'Controle Tático',
    description: 'Controle: trocas, curas, sabotagem de recursos e defesas incansáveis.',
    cards: {
      'char-ferrolho': 2, 'char-fortaleza': 2, 'char-bastiao': 1,
      'char-sombrio': 2, 'char-penumbra': 1, 'char-nihilux': 1,
      'char-flurro': 2, 'char-glaciar': 1,
      'char-curandeiro': 1, 'char-guardia': 1, 'char-drone': 1, 'char-automato': 1, 'char-lunaris': 1,
      'res-neutro': 7, 'res-umbra': 5, 'res-mare': 3, 'res-prisma': 2, 'res-ambar': 1, 'res-dinamo': 1,
      'act-manobra': 2, 'act-onda-choque': 2, 'act-sabotagem': 1, 'act-escudo': 2,
      'act-postura': 1, 'act-granada': 1, 'act-microbug': 1, 'act-inspiracao': 2,
      'act-reforcos': 1, 'act-reciclagem': 1, 'act-golpe': 1, 'act-rede': 1,
      'eq-escamas': 2, 'eq-botas': 2, 'eq-selo': 1, 'eq-canhao': 1,
      'fd-nevoeiro': 1, 'fd-zona-bloqueio': 1
    }
  }
];

/** Baralhos do tutorial (curtos, controlados). */
export const TUTORIAL_DECKS: DeckDef[] = [
  {
    id: 'deck-tutorial-aluno',
    name: 'Treinamento Nexo',
    description: 'Baralho guiado do tutorial.',
    cards: {
      'char-cindro': 3, 'char-chispito': 2, 'char-ignarok': 2, 'char-faiscante': 1,
      'res-solar': 5, 'res-volt': 4, 'res-neutro': 3,
      'act-golpe': 2, 'act-soro': 1, 'act-inspiracao': 1, 'act-manobra': 1, 'act-reforcos': 1,
      'eq-lamina': 1, 'fd-arena-solar': 1
    }
  },
  {
    id: 'deck-tutorial-instrutor',
    name: 'Instrutor',
    description: 'Baralho do instrutor (oponente do tutorial).',
    cards: {
      'char-sombrio': 2, 'char-vesper': 1, 'char-bandido': 1,
      'res-umbra': 5, 'res-neutro': 3
    }
  }
];

// ---------------------------------------------------------------------------
// Deck validation — centralized rules (config-driven)
// ---------------------------------------------------------------------------

export interface DeckValidation { valid: boolean; errors: string[]; counts: { total: number; byKind: Record<string, number> } }

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
