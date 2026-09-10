/**
 * PERFIS TCG CURADOS do JET CORE SET — derivados EXCLUSIVAMENTE da captura da
 * fonte oficial (RocksXB/jet-tactics. @ 769196ea55 — repo real com ponto final):
 *  - kits finais: docs/CURATED_ROSTER_v0.1 + js/game/curated-agents-6 (layer v2)
 *  - sidegrades de edição: docs/EDITION_SIDEGRADES_v0.1 + js/game/editions.js
 *
 * ARQUITETURA DE COMPOSIÇÃO (edições são VARIANTES, nunca evoluções):
 *
 *   baseProfile(agent)  +  editionSidegrade(slot)  →  editionProfile
 *
 * A variante HERDA da BASE: identity, HP, retreat, victoryValue, abilities/
 * passivas, ataques não substituídos, tags e facção. Substitui APENAS o slot
 * declarado pela fonte (`skill` ou `signature`) — identificado pelo campo
 * EXPLÍCITO `attack.role`, nunca pelo custo de energia. Se no futuro uma
 * edição alterar uma passiva, isso deve ser declarado em dados
 * (EDITION_VARIANTS.replaceAbility — hoje nenhum sidegrade oficial o usa).
 *
 * Convenções de conversão (fonte → TCG): Marca→`marked`(+10 dano recebido);
 * Exaustão→`exhausted` (não ataca no próximo turno do dono); Imobilizar→`root`
 * (não recua); Silenciar→`silence`; Atordoar→`stun`; Tenacidade→`tenacity`
 * (−20 dano recebido); Purificar→removeStatus 'all'; Rede→efeitos allAllies;
 * recuperar Ímpeto→drawCards; drenar Ímpeto→detachResource+discard; duelistas
 * solo→habilidade ativada com gatilho benchAtMost 0; "se JÁ estava Marcado"→
 * condição `hadStatus` (pré-estado da cadeia); "perdendo em PV"→vpCompare
 * 'less'. Fraqueza/resistência omitidas: a fonte não fornece anel de afinidade.
 * Raridade/holo NÃO conferem poder (Parte 10).
 */
import type { AbilityDef, AttackDef, CharacterDef } from '../../engine/types';
import type { AgentTcgProfile } from '../../integrations/jet/converter';
import { mkAbility, mkAttack, mkEffect } from '../../integrations/jet/converter';
import { profileKey } from '../../integrations/jet/importer';
import { JET_SNAPSHOT } from './snapshot';

const P = JET_SNAPSHOT.agents;
const V = JET_SNAPSHOT.editionVariants;
const CAP = JET_SNAPSHOT.capturedAt;

/** Repositório-fonte real (o nome do repo inclui o ponto final). */
const SOURCE_REPO = 'RocksXB/jet-tactics.';

function agent(name: string) {
  const identity = P.find((a) => a.name === name);
  if (!identity) throw new Error(`agente não capturado: ${name}`);
  return identity;
}

/** 'kof 12' → 'kof-12' (a fonte usa espaços no campo team; equipes usam slug). */
function teamSlug(team: string | undefined): string {
  if (!team) return 'neutro';
  const t = JET_SNAPSHOT.teams.find((x) => x.id === team || x.name.toLowerCase() === team.toLowerCase());
  return t?.id ?? team.toLowerCase().replace(/\s+/g, '-');
}

const E = mkEffect;

/** Attack builder local (custo genérico Energia JET + slot canônico explícito). */
function mkAttack0(
  id: string, name: string, cost: number, damage: number,
  effects: ReturnType<typeof mkEffect>[], text: string,
  role: 'skill' | 'signature'
): AttackDef {
  return mkAttack(id, name, [['*', cost]], damage, { effects, text, role });
}

// ---------------------------------------------------------------------------
// Perfis BASE (18) — kits finais da fonte (curated-agents-6)
// ---------------------------------------------------------------------------

interface BaseSpec {
  hp: number;
  retreat: number;
  vp: number;
  rarity: AgentTcgProfile['rarity'];
  attacks: AttackDef[];
  ability?: AbilityDef;
}

function baseProfile(name: string, b: BaseSpec): AgentTcgProfile {
  const identity = agent(name);
  const kit = JET_SNAPSHOT.kits.find((k) => k.agentId === identity.agentId);
  return {
    agentId: identity.agentId,
    edition: 'BASE',
    status: 'CURATED',
    cardId: `${identity.agentId}-base`,
    name: identity.name,
    faction: teamSlug(identity.team),
    rarity: b.rarity,
    maxHp: b.hp,
    retreatCost: b.retreat,
    victoryValue: b.vp,
    abilities: b.ability ? [b.ability] : [],
    attacks: b.attacks,
    tags: [teamSlug(identity.team), (kit?.archetype ?? '').toLowerCase()].filter(Boolean),
    flavor: undefined,
    text: kit?.summary,
    provenance: {
      sourceRepository: SOURCE_REPO,
      sourceType: 'curated-agents',
      sourceId: `curated-agents-6#${identity.playerKey}`,
      sourceEdition: 'BASE',
      capturedAt: CAP,
      sourceCommit: JET_SNAPSHOT.sourceCommit
    }
  };
}

// ---------------------------------------------------------------------------
// Sidegrades oficiais (10) — EDITION_SIDEGRADES_v0.1
// Cada entrada substitui EXATAMENTE um slot (role explícito) da BASE.
// ---------------------------------------------------------------------------

interface EditionVariantSpec {
  /** Nome do agente na fonte (liga com a BASE). */
  name: string;
  edition: string;
  rarity: AgentTcgProfile['rarity'];
  /** Slot canônico substituído — igual ao `role` do ataque removido. */
  replaces: 'skill' | 'signature';
  /** Se declarado, substitui a passiva da BASE (nenhum sidegrade oficial usa hoje). */
  replaceAbility?: AbilityDef;
  attack: AttackDef;
}

function editionVariant(
  name: string, edition: string, rarity: AgentTcgProfile['rarity'],
  replaces: 'skill' | 'signature', attack: AttackDef, replaceAbility?: AbilityDef
): EditionVariantSpec {
  return { name, edition, rarity, replaces, attack, replaceAbility };
}

const EDITION_VARIANTS: EditionVariantSpec[] = [
  // ===== MVP =============================================================
  editionVariant('Jenny', 'MVP', 'epic', 'skill',
    mkAttack('agent-jenny-mvp-tempo', 'MVP Tempo', [['*', 1]], 10,
      { role: 'skill', effects: [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 2 })],
        text: '10 de dano. Este Agente ganha Tenacidade (−20 dano recebido) por 2 turnos.' })),
  editionVariant('Wei Wang', 'MVP', 'epic', 'signature',
    mkAttack('agent-wei-wang-mvp-lock', 'MVP Lock', [['*', 2]], 40,
      { role: 'signature', effects: [E('applyStatus', { status: 'silence', tokens: 2 }), E('detachResource', { target: 'enemyActive', amount: 1, to: 'discard' })],
        text: '40 de dano. Silencia o Ativo inimigo e descarta 1 das Energias conectadas a ele.' })),
  // ===== CHAMPION ========================================================
  editionVariant('Ran Yuki', 'CHAMPION', 'epic', 'signature',
    mkAttack('agent-ran-yuki-champion-point', 'Champion Point', [['*', 2]], 50,
      { role: 'signature', effects: [E('applyStatus', { status: 'silence', tokens: 2 })],
        text: '50 de dano. Silencia o Ativo inimigo por 2 turnos.' })),
  editionVariant('Shirakami Niku', 'CHAMPION', 'epic', 'signature',
    mkAttack('agent-shirakami-niku-trono-inab', 'Trono Inabalável', [['*', 2]], 50,
      { role: 'signature', effects: [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 2 })],
        text: '50 de dano. Este Agente ganha Tenacidade por 2 turnos.' })),
  editionVariant('Ryan Smith', 'CHAMPION', 'epic', 'signature',
    mkAttack('agent-ryan-smith-comando-campeao', 'Comando de Campeão', [['*', 2]], 0,
      { role: 'signature', effects: [E('heal', { target: 'allAllies', amount: 30 }), E('drawCards', { amount: 2 })],
        text: 'Cure 30 de todos os seus Agentes e compre 2 cartas.' })),
  editionVariant('Saki', 'CHAMPION', 'epic', 'signature',
    mkAttack('agent-saki-golpe-titulo', 'Golpe do Título', [['*', 2]], 50,
      { role: 'signature', effects: [E('detachResource', { target: 'enemyActive', amount: 1, to: 'discard' }), E('applyStatus', { status: 'exhausted', tokens: 1 })],
        text: '50 de dano. Descarte 1 Energia do Ativo inimigo e o Exauste (não ataca no próximo turno).' })),
  // ===== FINALS ==========================================================
  editionVariant('Alice Westland', 'FINALS', 'epic', 'skill',
    mkAttack('agent-alice-westland-final-cover', 'Final Cover', [['*', 1]], 10,
      { role: 'skill', effects: [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 2 })],
        text: '10 de dano. Este Agente ganha Tenacidade por 2 turnos.' })),
  editionVariant('Tarruh', 'FINALS', 'epic', 'skill',
    mkAttack('agent-tarruh-allin-final', 'All-In de Final', [['*', 1]], 35,
      { role: 'skill', text: '35 de dano. Tudo ou nada — sem proteção.' })),
  editionVariant('Tayná Lannister Müller', 'FINALS', 'epic', 'skill',
    mkAttack('agent-tayna-lannister-muller-fechamento-final', 'Fechamento de Final', [['*', 1]], 10,
      { role: 'skill', effects: [E('applyStatus', { status: 'silence', tokens: 2 })],
        text: '10 de dano. O Agente Ativo inimigo fica Silenciado (habilidades bloqueadas) por 2 turnos.' })),
  // ===== ICON ============================================================
  editionVariant('Mik Kashnov', 'ICON', 'legendary', 'skill',
    mkAttack('agent-mik-kashnov-icone-campo', 'Ícone de Campo', [['*', 1]], 10,
      { role: 'skill', effects: [E('applyStatus', { status: 'silence', tokens: 2 })],
        text: '10 de dano. Silencia o Ativo inimigo por 2 turnos.' }))
];

/** Composição: baseProfile + editionSidegrade → editionProfile. */
function composeVariant(base: AgentTcgProfile, v: EditionVariantSpec): AgentTcgProfile {
  const identity = agent(v.name);
  const cardId = `${identity.agentId}-${v.edition.toLowerCase()}`;
  const slot = V.find((x) => x.agentId === identity.agentId && x.edition === v.edition);
  if (!slot) throw new Error(`sidegrade curado não encontrado: ${v.name} ${v.edition}`);
  if (slot.replaces !== v.replaces) {
    throw new Error(`${cardId}: fonte substitui '${slot.replaces}' mas a variante declara '${v.replaces}'`);
  }
  const idx = base.attacks.findIndex((a) => a.role === v.replaces);
  if (idx < 0) throw new Error(`${cardId}: BASE sem ataque role='${v.replaces}'`);
  const attacks = [...base.attacks];
  attacks[idx] = { ...v.attack, role: v.replaces };
  return {
    ...base,
    cardId,
    edition: v.edition,
    name: `${identity.name} ${v.edition}`,
    rarity: v.rarity,
    attacks,
    abilities: v.replaceAbility ? [v.replaceAbility] : base.abilities,
    flavor: slot.tradeoff,
    provenance: {
      ...base.provenance,
      sourceId: `curated-agents-6#${identity.playerKey} + editions#${v.edition}`,
      sourceEdition: v.edition
    }
  };
}

// ---------------------------------------------------------------------------
// 18 perfis BASE
// ---------------------------------------------------------------------------

const BASE_PROFILES: AgentTcgProfile[] = [
  // ===== KOF 12 ==========================================================
  baseProfile('Jenny', {
    hp: 100, retreat: 1, vp: 1, rarity: 'rare',
    ability: mkAbility('ab-jenny-batida', 'Batida que se Paga', 'activated', {
      zone: 'any', oncePerTurn: true, cost: [],
      effects: [E('drawCards', { amount: 1 })],
      text: 'Uma vez por turno: compre 1 carta. (Apoio gera economia — passiva convertida.)'
    }),
    attacks: [
      mkAttack0('atk-jenny-impulso', 'Impulso de Equipe', 1, 10, [
        E('drawCards', { amount: 1 }), E('removeStatus', { target: 'allAllies', status: 'all' })
      ], '10 de dano. Compre 1 carta e Purifique seus Agentes.', 'skill'),
      mkAttack0('atk-jenny-todos-ritmo', 'Todos no Ritmo', 2, 0, [
        E('heal', { target: 'allAllies', amount: 30 }),
        E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 })
      ], 'Cure 30 de todos os seus Agentes e conceda Tenacidade (−20 dano recebido) a eles.', 'signature')
    ]
  }),
  baseProfile('Xixim', {
    hp: 110, retreat: 1, vp: 2, rarity: 'common',
    attacks: [
      mkAttack0('atk-xixim-tranco', 'Tranco Seco', 1, 20, [E('applyStatus', { status: 'exhausted', tokens: 1 })],
        '20 de dano. Exauste o Ativo inimigo (não ataca no próximo turno).', 'skill'),
      mkAttack0('atk-xixim-queda', 'Queda de Ritmo', 2, 30, [
        E('detachResource', { target: 'enemyActive', amount: 1, to: 'discard' }),
        E('applyStatus', { target: 'allEnemies', status: 'exhausted', tokens: 1 })
      ], '30 de dano. Descarte 1 Energia do Ativo inimigo e Exauste TODOS os Agentes inimigos.', 'signature')
    ]
  }),
  baseProfile('Ran Yuki', {
    hp: 100, retreat: 1, vp: 1, rarity: 'rare',
    attacks: [
      mkAttack0('atk-ran-ponto', 'Ponto de Entrada', 1, 20, [E('drawCards', { amount: 1 })],
        '20 de dano. Compre 1 carta.', 'skill'),
      mkAttack0('atk-ran-duelo', 'Duelo de Set', 2, 40, [
        E('applyStatus', { status: 'marked', tokens: 2 }),
        E('conditionalEffect', { condition: { op: 'vpCompare', compare: 'less' }, then: [E('drawCards', { amount: 1 })] })
      ], '40 de dano. Marca o Ativo inimigo por 2 turnos. Se você estiver perdendo em PV, compre 1 carta.', 'signature')
    ]
  }),
  baseProfile('Shirakami Niku', {
    hp: 140, retreat: 2, vp: 2, rarity: 'rare',
    attacks: [
      mkAttack0('atk-shira-fortaleza', 'Fortaleza Móvel', 1, 15, [E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 })],
        '15 de dano. Seus Agentes ganham Tenacidade (−20 dano recebido).', 'skill'),
      mkAttack0('atk-shira-trono', 'Trono Absoluto', 3, 40, [
        E('removeStatus', { target: 'allAllies', status: 'all' }),
        E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 2 })
      ], '40 de dano. Purifique e conceda Tenacidade (2 turnos) a todos os seus Agentes.', 'signature')
    ]
  }),

  // ===== ASGARD ==========================================================
  baseProfile('Alice Westland', {
    hp: 100, retreat: 1, vp: 1, rarity: 'uncommon',
    ability: mkAbility('ab-alice-revezamento', 'Passe de Revezamento', 'activated', {
      zone: 'any', oncePerTurn: true, cost: [],
      effects: [E('heal', { target: 'activeAlly', amount: 20 })],
      text: 'Uma vez por turno: cure 20 do seu Agente Ativo. (Apoio que acelera a linha — passiva convertida.)'
    }),
    attacks: [
      mkAttack0('atk-alice-reforco', 'Reforço Lateral', 1, 10, [E('removeStatus', { target: 'activeAlly', status: 'all' })],
        '10 de dano. Purifique seu Agente Ativo.', 'skill'),
      mkAttack0('atk-alice-rotacao', 'Rotação Asgard', 2, 0, [
        E('heal', { target: 'allAllies', amount: 20 }), E('drawCards', { amount: 1 })
      ], 'Cure 20 de todos os seus Agentes e compre 1 carta.', 'signature')
    ]
  }),
  baseProfile('Tarruh', {
    hp: 130, retreat: 2, vp: 2, rarity: 'uncommon',
    attacks: [
      mkAttack0('atk-tarruh-linha', 'Linha de Aço', 1, 20, [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 1 })],
        '20 de dano. Este Agente ganha Tenacidade (−20 dano recebido).', 'skill'),
      mkAttack0('atk-tarruh-parede', 'Parede de Asgard', 2, 30, [
        E('heal', { target: 'allAllies', amount: 10 }),
        E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 })
      ], '30 de dano. Cure 10 e conceda Tenacidade a todos os seus Agentes.', 'signature')
    ]
  }),
  baseProfile('Tayná Lannister Müller', {
    hp: 110, retreat: 1, vp: 1, rarity: 'uncommon',
    attacks: [
      mkAttack0('atk-tayna-corte', 'Corte de Ritmo', 1, 10, [E('applyStatus', { status: 'exhausted', tokens: 1 })],
        '10 de dano. Exauste o Ativo inimigo.', 'skill'),
      mkAttack0('atk-tayna-fecho', 'Fecho Real', 2, 20, [
        E('applyStatus', { target: 'allEnemies', status: 'silence', tokens: 2 }),
        E('detachResource', { target: 'enemyActive', amount: 1, to: 'discard' })
      ], '20 de dano. Silencie TODOS os Agentes inimigos por 2 turnos e descarte 1 Energia do Ativo inimigo.', 'signature')
    ]
  }),

  // ===== MORNING STAR ====================================================
  baseProfile('Henry', {
    hp: 130, retreat: 2, vp: 2, rarity: 'uncommon',
    ability: mkAbility('ab-henry-escolta', 'Interceptação de Escolta', 'whileBench', {
      mods: { damageTakenFlat: 10 },
      text: 'Enquanto Henry está na Reserva, seus Agentes recebem 10 de dano a menos. (Escolta — passiva convertida.)'
    }),
    attacks: [
      mkAttack0('atk-henry-corredor', 'Corredor Seguro', 1, 15, [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 1 })],
        '15 de dano. Este Agente ganha Tenacidade.', 'skill'),
      mkAttack0('atk-henry-extracao', 'Extração em Cadeia', 2, 30, [E('removeStatus', { target: 'allAllies', status: 'all' }), E('heal', { target: 'allAllies', amount: 10 })],
        '30 de dano. Purifique e cure 10 de todos os seus Agentes.', 'signature')
    ]
  }),
  baseProfile('Mik Kashnov', {
    hp: 100, retreat: 1, vp: 1, rarity: 'uncommon',
    attacks: [
      mkAttack0('atk-mik-pulso', 'Pulso de Retorno', 1, 10, [E('heal', { target: 'activeAlly', amount: 20 })],
        '10 de dano. Cure 20 do seu Agente Ativo.', 'skill'),
      mkAttack0('atk-mik-malha', 'Malha Morning Star', 2, 0, [
        E('heal', { target: 'allAllies', amount: 20 }), E('drawCards', { amount: 1 }),
        E('conditionalEffect', { condition: { op: 'vpCompare', compare: 'less' }, then: [E('drawCards', { amount: 1 })] })
      ], 'Cure 20 de todos os seus Agentes e compre 1 carta (2 se estiver perdendo em PV).', 'signature')
    ]
  }),
  baseProfile('Ryan Smith', {
    hp: 110, retreat: 1, vp: 1, rarity: 'uncommon',
    attacks: [
      mkAttack0('atk-ryan-linha', 'Linha de Comando', 1, 10, [
        E('removeStatus', { target: 'activeAlly', status: 'all' }),
        E('conditionalEffect', { condition: { op: 'vpCompare', compare: 'less' }, then: [E('drawCards', { amount: 1 })] })
      ], '10 de dano. Purifique seu Ativo. Se estiver perdendo em PV, compre 1 carta.', 'skill'),
      mkAttack0('atk-ryan-todos', 'Todos de Pé', 2, 0, [
        E('heal', { target: 'allAllies', amount: 20 }),
        E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 }),
        E('conditionalEffect', { condition: { op: 'vpCompare', compare: 'less' }, then: [E('drawCards', { amount: 1 })] })
      ], 'Cure 20 e conceda Tenacidade a todos os seus Agentes. Perdendo em PV: compre 1 carta.', 'signature')
    ]
  }),
  baseProfile('Saki', {
    hp: 110, retreat: 1, vp: 2, rarity: 'rare',
    attacks: [
      mkAttack0('atk-saki-fissura', 'Fissura de Cobrança', 1, 20, [
        E('applyStatus', { status: 'marked', tokens: 2 }),
        E('conditionalEffect', { condition: { op: 'hadStatus', status: 'marked', target: 'defender' }, then: [E('detachResource', { target: 'activeAlly', amount: 1, to: 'discard' }), E('removeStatus', { status: 'marked' })] })
      ], '20 de dano e Marca o Ativo inimigo (2 turnos). Se ele JÁ estava Marcado: descarte 1 das suas Energias e consuma a Marca.', 'skill'),
      mkAttack0('atk-saki-golpe-duplo', 'Golpe de Cobrança Dupla', 2, 30, [
        E('applyStatus', { status: 'exhausted', tokens: 1 })
      ], '30 de dano. Exauste o Ativo inimigo.', 'signature')
    ]
  }),

  // ===== BASTARD GRAN TUBARÕES XYZ =======================================
  baseProfile('Kaio', {
    hp: 110, retreat: 1, vp: 2, rarity: 'rare',
    attacks: [
      mkAttack0('atk-kaio-ruptura', 'Ruptura Violeta', 1, 20, [E('applyStatus', { status: 'marked', tokens: 2 })],
        '20 de dano e Marca o Ativo inimigo por 2 turnos.', 'skill'),
      mkAttack0('atk-kaio-colapso', 'Colapso em Cadeia', 2, 40, [
        E('applyStatus', { status: 'exhausted', tokens: 1 }),
        E('conditionalEffect', { condition: { op: 'hadStatus', status: 'marked', target: 'defender' }, then: [E('detachResource', { target: 'activeAlly', amount: 1, to: 'discard' }), E('removeStatus', { status: 'marked' })] })
      ], '40 de dano. Exauste o Ativo inimigo. Se ele JÁ estava Marcado: descarte 1 das suas Energias e consuma a Marca.', 'signature')
    ]
  }),
  baseProfile('Ruby', {
    hp: 100, retreat: 1, vp: 1, rarity: 'common',
    ability: mkAbility('ab-ruby-palco', 'Palco sem Testemunhas', 'activated', {
      zone: 'any', oncePerTurn: true, cost: [],
      effects: [E('conditionalEffect', { condition: { op: 'benchAtMost', value: 0 }, then: [E('drawCards', { amount: 1 })] })],
      text: 'Uma vez por turno: se Ruby for sua única Agente em campo, compre 1 carta. (Duelista solo — passiva convertida.)'
    }),
    attacks: [
      mkAttack0('atk-ruby-finta', 'Finta Rubra', 1, 10, [E('applyStatus', { status: 'marked', tokens: 2 })],
        '10 de dano e Marca o Ativo inimigo por 2 turnos.', 'skill'),
      mkAttack0('atk-ruby-tudo', 'Tudo no Vermelho', 2, 40, [
        E('applyStatus', { status: 'root', tokens: 1 }),
        E('conditionalEffect', { condition: { op: 'hadStatus', status: 'marked', target: 'defender' }, then: [E('dealDamage', { target: 'defender', amount: 10 }), E('removeStatus', { status: 'marked' })] })
      ], '40 de dano. Imobiliza o Ativo inimigo (não recua). Se ele JÁ estava Marcado: +10 de dano e consome a Marca.', 'signature')
    ]
  }),

  // ===== RAINBOW SIX =====================================================
  baseProfile('Wei Fang', {
    hp: 110, retreat: 2, vp: 1, rarity: 'uncommon',
    attacks: [
      mkAttack0('atk-weifang-corte', 'Corte de Canal', 1, 10, [E('applyStatus', { status: 'exhausted', tokens: 1 }), E('detachResource', { target: 'activeAlly', amount: 1, to: 'discard' })],
        '10 de dano. Exauste o Ativo inimigo e descarte 1 das suas Energias.', 'skill'),
      mkAttack0('atk-weifang-blackout', 'Blackout Tático', 2, 30, [E('applyStatus', { status: 'silence', tokens: 2 }), E('detachResource', { target: 'activeAlly', amount: 1, to: 'discard' })],
        '30 de dano. Silencie o Ativo inimigo (2 turnos) e descarte 1 das suas Energias.', 'signature')
    ]
  }),
  baseProfile('Wei Wang', {
    hp: 110, retreat: 1, vp: 1, rarity: 'rare',
    attacks: [
      mkAttack0('atk-weiwang-interdicao', 'Interdição', 1, 10, [E('applyStatus', { status: 'marked', tokens: 2 })],
        '10 de dano e Marca o Ativo inimigo por 2 turnos.', 'skill'),
      mkAttack0('atk-weiwang-zona', 'Zona Morta', 2, 30, [
        E('applyStatus', { status: 'stun', tokens: 1 }),
        E('conditionalEffect', { condition: { op: 'hadStatus', status: 'marked', target: 'defender' }, then: [E('applyStatus', { status: 'root', tokens: 1 }), E('removeStatus', { status: 'marked' })] })
      ], '30 de dano e Atordoa o Ativo inimigo. Se ele JÁ estava Marcado: também o Imobiliza e consome a Marca.', 'signature')
    ]
  }),

  // ===== SALVATORE / PLATINUM / WEIGON ===================================
  baseProfile('Hashika Gloves', {
    hp: 100, retreat: 1, vp: 1, rarity: 'rare',
    ability: mkAbility('ab-hashika-caca', 'Predador à Vista', 'activated', {
      zone: 'any', oncePerTurn: true, cost: [],
      effects: [E('conditionalEffect', { condition: { op: 'hasStatus', status: 'marked', target: 'enemyActive' }, then: [E('drawCards', { amount: 1 })] })],
      text: 'Uma vez por turno: se o Ativo inimigo estiver Marcado, compre 1 carta. (Caçada — passiva convertida.)'
    }),
    attacks: [
      mkAttack0('atk-hashika-rastro', 'Rastro de Corte', 1, 10, [E('applyStatus', { status: 'marked', tokens: 2 })],
        '10 de dano e Marca o Ativo inimigo por 2 turnos.', 'skill'),
      mkAttack0('atk-hashika-quarto', 'Quarto Fechado', 2, 40, [
        E('applyStatus', { status: 'silence', tokens: 2 }),
        E('conditionalEffect', { condition: { op: 'hadStatus', status: 'marked', target: 'defender' }, then: [E('applyStatus', { status: 'root', tokens: 1 }), E('removeStatus', { status: 'marked' })] })
      ], '40 de dano. Silencia o Ativo inimigo. Se ele JÁ estava Marcado: também o Imobiliza e consome a Marca.', 'signature')
    ]
  }),
  baseProfile('Baek Seo-jin', {
    hp: 110, retreat: 1, vp: 1, rarity: 'uncommon',
    attacks: [
      mkAttack0('atk-baek-fantasma', 'Interferência Fantasma', 1, 10, [E('applyStatus', { status: 'silence', tokens: 2 })],
        '10 de dano. Silencia o Ativo inimigo por 2 turnos.', 'skill'),
      mkAttack0('atk-baek-lockdown', 'Lockdown Neural', 2, 30, [E('applyStatus', { status: 'silence', tokens: 2 }), E('applyStatus', { status: 'stun', tokens: 1 })],
        '30 de dano. Silencia e Atordoa o Ativo inimigo.', 'signature')
    ]
  }),
  baseProfile('Olivia Mih', {
    hp: 130, retreat: 2, vp: 2, rarity: 'uncommon',
    attacks: [
      mkAttack0('atk-olivia-retorno', 'Ponto de Retorno', 1, 10, [
        E('removeStatus', { target: 'self', status: 'all' }),
        E('applyStatus', { target: 'self', status: 'tenacity', tokens: 1 })
      ], '10 de dano. Purifica-se e ganha Tenacidade.', 'skill'),
      mkAttack0('atk-olivia-estabilidade', 'Campo de Estabilidade', 2, 20, [
        E('removeStatus', { target: 'allAllies', status: 'all' }),
        E('heal', { target: 'allAllies', amount: 20 })
      ], '20 de dano. Purifica e cura 20 de todos os seus Agentes.', 'signature')
    ]
  })
];

// ---------------------------------------------------------------------------
// Catálogo final: BASE + composição das variantes
// ---------------------------------------------------------------------------

const VARIANT_PROFILES: AgentTcgProfile[] = EDITION_VARIANTS.map((v) => {
  const base = BASE_PROFILES.find((b) => b.name === v.name && b.edition === 'BASE');
  if (!base) throw new Error(`variante sem BASE: ${v.name}`);
  return composeVariant(base, v);
});

export const AGENT_TCG_PROFILES: Record<string, AgentTcgProfile> = Object.fromEntries(
  [...BASE_PROFILES, ...VARIANT_PROFILES].map((p) => [profileKey(p.agentId, p.edition), p])
);

/** Lista dos sidegrades oficiais (para testes e catálogo). */
export const OFFICIAL_EDITION_VARIANTS = EDITION_VARIANTS;
