import type { AttackDef, AbilityDef } from '../../engine/types';
import type { AgentTcgProfile } from '../../integrations/jet/converter';
import { mkAbility, mkAttack, mkEffect } from '../../integrations/jet/converter';
import { profileKey } from '../../integrations/jet/importer';
import { JET_SNAPSHOT } from './snapshot';

/**
 * PERFIS TCG CURADOS — JET CORE SET (Alpha)
 *
 * A tradução criativa da identidade competitiva (passiva/Habilidade/Técnica
 * Suprema do Jet Tactics) para mecânicas de TCG. Convenções (ver
 * docs/TCG_BALANCE_GUIDE.md):
 *
 *  - Influência/pressão própria (boost)     → dano direto
 *  - Influência inimiga perdida (disrupt)   → dano direto (menor) + riders
 *  - Marca                                  → status `marked` (+10 dano recebido)
 *  - Exaustão                               → status `exhausted` (não ataca)
 *  - Imobilizar                             → status `root` (não recua)
 *  - Silenciar / cortar Apoio               → status `silence`
 *  - Atordoar                               → status `stun`
 *  - Tenacidade / bloquear Confrontos       → status `tenacity` (−20 dano)
 *  - Purificar                              → removeStatus 'all'
 *  - Rede (valor por linha com aliado)      → efeito em todos os aliados
 *  - Recuperar Ímpeto                       → comprar carta / conectar Energia
 *  - Drenar Ímpeto                          → descartar Energia inimiga
 *  - Duelistas solo (solo_contest)          → habilidade ativada "sozinho em campo"
 *
 * TODAS as variantes de edição são SIDE GRADES com tradeoff documentado na
 * fonte (EDITION_SIDEGRADES_v0.1.md) — nunca upgrades brutos. Raridade e holo
 * NÃO conferem poder (Parte 10). Fraqueza/resistência omitidas: a fonte não
 * fornece anel de afinidade (Parte 11).
 */

const P = JET_SNAPSHOT.agents;
const V = JET_SNAPSHOT.editionVariants;
const CAP = JET_SNAPSHOT.capturedAt;

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

interface Base {
  hp: number;
  retreat: number;
  vp: number;
  rarity: AgentTcgProfile['rarity'];
  attacks: AttackDef[];
  ability?: AbilityDef;
}

function profile(name: string, edition: string, b: Base): AgentTcgProfile {
  const identity = agent(name);
  const kit = JET_SNAPSHOT.kits.find((k) => k.agentId === identity.agentId);
  const cardId = edition === 'BASE' ? `${identity.agentId}-base` : `${identity.agentId}-${edition.toLowerCase()}`;
  const displayName = edition === 'BASE' ? identity.name : `${identity.name} ${edition}`;
  const slot = edition === 'BASE' ? null : V.find((v) => v.agentId === identity.agentId && v.edition === edition);
  if (edition !== 'BASE' && !slot) throw new Error(`sidegrade curado não encontrado: ${name} ${edition}`);
  const attacks: AttackDef[] = [...b.attacks];
  if (slot) {
    // substituição OFICIAL do slot (skill/signature) pela variante da edição
    const total = (a: AttackDef) => a.cost.reduce((s, c) => s + c.amount, 0);
    const idx = attacks.findIndex((a) => (slot.replaces === 'skill' ? total(a) === 1 : total(a) >= 2));
    if (idx >= 0) attacks[idx] = editionAttack(slot, cardId);
  }
  return {
    agentId: identity.agentId,
    edition,
    status: 'CURATED',
    cardId,
    name: displayName,
    faction: teamSlug(identity.team),
    rarity: b.rarity,
    maxHp: b.hp,
    retreatCost: b.retreat,
    victoryValue: b.vp,
    abilities: b.ability ? [b.ability] : [],
    attacks,
    tags: [teamSlug(identity.team), (kit?.archetype ?? '').toLowerCase()].filter(Boolean),
    flavor: slot ? slot.tradeoff : undefined,
    text: kit?.summary,
    provenance: {
      sourceRepository: 'RocksXB/jet-tactics',
      sourceType: 'curated-agents',
      sourceId: `curated-agents-6#${identity.playerKey}${edition !== 'BASE' ? ` + editions#${edition}` : ''}`,
      sourceEdition: edition,
      capturedAt: CAP,
      sourceCommit: JET_SNAPSHOT.sourceCommit
    }
  };
}

/** Converte a ação oficial da edição em ataque TCG com o MESMO nome. */
function editionAttack(slot: { agentId: string; edition: string; replaces: 'skill' | 'signature'; tradeoff: string; action: { name: string; text?: string } }, cardId: string): AttackDef {
  void cardId;
  const name = slot.action.name;
  const heavy = slot.replaces === 'signature';
  // números por tipo de efeito oficial (tabela EDITION_SIDEGRADES adaptada ao budget TCG)
  switch (name) {
    case 'MVP Tempo': return mkAttack(`${slot.agentId}-mvp-tempo`, name, [['*', 1]], 10, { effects: [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 2 })], text: '10 de dano. Este Agente ganha Tenacidade (−20 dano recebido) por 2 turnos.' });
    case 'Final Cover': return mkAttack(`${slot.agentId}-final-cover`, name, [['*', 1]], 10, { effects: [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 2 })], text: '10 de dano. Este Agente ganha Tenacidade por 2 turnos.' });
    case 'All-In de Final': return mkAttack(`${slot.agentId}-allin-final`, name, [['*', 1]], 35, { text: '35 de dano. Tudo ou nada — sem proteção.' });
    case 'Fechamento de Final': return mkAttack(`${slot.agentId}-fechamento-final`, name, [['*', 1]], 10, { effects: [E('applyStatus', { status: 'silence', tokens: 2 })], text: '10 de dano. O Agente Ativo inimigo fica Silenciado (habilidades bloqueadas) por 2 turnos.' });
    case 'Champion Point': return mkAttack(`${slot.agentId}-champion-point`, name, [['*', 2]], 50, { effects: [E('applyStatus', { status: 'silence', tokens: 2 })], text: '50 de dano. Silencia o Ativo inimigo por 2 turnos.' });
    case 'Trono Inabalável': return mkAttack(`${slot.agentId}-trono-inab`, name, [['*', 2]], 50, { effects: [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 2 })], text: '50 de dano. Este Agente ganha Tenacidade por 2 turnos.' });
    case 'MVP Lock': return mkAttack(`${slot.agentId}-mvp-lock`, name, [['*', 2]], 40, { effects: [E('applyStatus', { status: 'silence', tokens: 2 }), E('detachResource', { amount: 1, to: 'discard' })], text: '40 de dano. Silencia o Ativo inimigo e descarta 1 das suas Energias conectadas a ele.' });
    case 'Ícone de Campo': return mkAttack(`${slot.agentId}-icone-campo`, name, [['*', 1]], 10, { effects: [E('applyStatus', { status: 'silence', tokens: 2 })], text: '10 de dano. Silencia o Ativo inimigo por 2 turnos.' });
    case 'Comando de Campeão': return mkAttack(`${slot.agentId}-comando-campeao`, name, [['*', 2]], 0, { effects: [E('heal', { target: 'allAllies', amount: 30 }), E('drawCards', { amount: 2 })], text: 'Cure 30 de todos os seus Agentes e compre 2 cartas.' });
    case 'Golpe do Título': return mkAttack(`${slot.agentId}-golpe-titulo`, name, [['*', 2]], 50, { effects: [E('detachResource', { amount: 1, to: 'discard' }), E('applyStatus', { status: 'exhausted', tokens: 1 })], text: '50 de dano. Descarte 1 Energia do Ativo inimigo e o Exauste (não ataca no próximo turno).' });
    default:
      // fallback defensivo: conversão genérica do slot (não deve ocorrer com a fonte atual)
      return mkAttack(`${slot.agentId}-${slot.edition.toLowerCase()}-${slot.replaces}`, name, [['*', heavy ? 2 : 1]], heavy ? 40 : 15, { text: slot.action.text });
  }
}

const E = mkEffect;

// ---------------------------------------------------------------------------
// 18 perfis BASE (kits finais — curated-agents-6) + 10 sidegrades oficiais
// ---------------------------------------------------------------------------

export const AGENT_TCG_PROFILES: Record<string, AgentTcgProfile> = Object.fromEntries(
  [
    // ===== KOF 12 ==========================================================
    profile('Jenny', 'BASE', {
      hp: 100, retreat: 1, vp: 1, rarity: 'rare',
      ability: mkAbility('ab-jenny-batida', 'Batida que se Paga', 'activated', {
        zone: 'any', oncePerTurn: true, cost: [],
        effects: [E('drawCards', { amount: 1 })],
        text: 'Uma vez por turno: compre 1 carta. (Apoio gera economia — passiva convertida.)'
      }),
      attacks: [
        mkAttack0('atk-jenny-impulso', 'Impulso de Equipe', 1, 10, [
          E('drawCards', { amount: 1 }), E('removeStatus', { target: 'allAllies', status: 'all' })
        ], '10 de dano. Compre 1 carta e Purifique seus Agentes.'),
        mkAttack0('atk-jenny-todos-ritmo', 'Todos no Ritmo', 2, 0, [
          E('heal', { target: 'allAllies', amount: 30 }),
          E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 })
        ], 'Cure 30 de todos os seus Agentes e conceda Tenacidade (−20 dano recebido) a eles.')
      ]
    }),
    profile('Jenny', 'MVP', { hp: 100, retreat: 1, vp: 1, rarity: 'rare', attacks: [mkAttack0('atk-jenny-impulso', 'Impulso de Equipe', 1, 10, [E('drawCards', { amount: 1 }), E('removeStatus', { target: 'allAllies', status: 'all' })], '10 de dano. Compre 1 carta e Purifique seus Agentes.'), mkAttack0('atk-jenny-todos-ritmo', 'Todos no Ritmo', 2, 0, [E('heal', { target: 'allAllies', amount: 30 }), E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 })], 'Cure 30 de todos e conceda Tenacidade.')] }),

    profile('Xixim', 'BASE', {
      hp: 110, retreat: 1, vp: 2, rarity: 'common',
      attacks: [
        mkAttack0('atk-xixim-tranco', 'Tranco Seco', 1, 20, [E('applyStatus', { status: 'exhausted', tokens: 1 })], '20 de dano. Exauste o Ativo inimigo (não ataca no próximo turno).'),
        mkAttack0('atk-xixim-queda', 'Queda de Ritmo', 2, 30, [
          E('detachResource', { amount: 1, to: 'discard' }),
          E('applyStatus', { target: 'allEnemies', status: 'exhausted', tokens: 1 })
        ], '30 de dano. Descarte 1 Energia do Ativo inimigo e Exauste TODOS os Agentes inimigos.')
      ]
    }),
    profile('Ran Yuki', 'BASE', {
      hp: 100, retreat: 1, vp: 1, rarity: 'rare',
      attacks: [
        mkAttack0('atk-ran-ponto', 'Ponto de Entrada', 1, 20, [E('drawCards', { amount: 1 })], '20 de dano. Compre 1 carta.'),
        mkAttack0('atk-ran-duelo', 'Duelo de Set', 2, 40, [
          E('applyStatus', { status: 'marked', tokens: 2 }),
          E('conditionalEffect', { condition: { op: 'vpCompare', compare: 'less' }, then: [E('drawCards', { amount: 1 })] })
        ], '40 de dano. Marca o Ativo inimigo por 2 turnos. Se você estiver perdendo em PV, compre 1 carta.')
      ]
    }),
    profile('Ran Yuki', 'CHAMPION', { hp: 100, retreat: 1, vp: 1, rarity: 'epic', attacks: [mkAttack0('atk-ran-ponto', 'Ponto de Entrada', 1, 20, [E('drawCards', { amount: 1 })], '20 de dano. Compre 1 carta.'), mkAttack0('atk-ran-duelo', 'Duelo de Set', 2, 40, [E('applyStatus', { status: 'marked', tokens: 2 }), E('conditionalEffect', { condition: { op: 'vpCompare', compare: 'less' }, then: [E('drawCards', { amount: 1 })] })], '40 de dano. Marca por 2 turnos. Perdendo em PV: compre 1.')] }),
    profile('Shirakami Niku', 'BASE', {
      hp: 140, retreat: 2, vp: 2, rarity: 'rare',
      attacks: [
        mkAttack0('atk-shira-fortaleza', 'Fortaleza Móvel', 1, 15, [E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 })], '15 de dano. Seus Agentes ganham Tenacidade (−20 dano recebido).'),
        mkAttack0('atk-shira-trono', 'Trono Absoluto', 3, 40, [
          E('removeStatus', { target: 'allAllies', status: 'all' }),
          E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 2 })
        ], '40 de dano. Purifique e conceda Tenacidade (2 turnos) a todos os seus Agentes.')
      ]
    }),
    profile('Shirakami Niku', 'CHAMPION', { hp: 140, retreat: 2, vp: 2, rarity: 'epic', attacks: [mkAttack0('atk-shira-fortaleza', 'Fortaleza Móvel', 1, 15, [E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 })], '15 de dano. Tenacidade para seus Agentes.'), mkAttack0('atk-shira-trono-inab', 'Trono Inabalável', 2, 50, [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 2 })], '50 de dano. Este Agente ganha Tenacidade por 2 turnos.')] }),

    // ===== ASGARD ==========================================================
    profile('Alice Westland', 'BASE', {
      hp: 100, retreat: 1, vp: 1, rarity: 'uncommon',
      ability: mkAbility('ab-alice-revezamento', 'Passe de Revezamento', 'activated', {
        zone: 'any', oncePerTurn: true, cost: [],
        effects: [E('heal', { target: 'activeAlly', amount: 20 })],
        text: 'Uma vez por turno: cure 20 do seu Agente Ativo. (Apoio que acelera a linha — passiva convertida.)'
      }),
      attacks: [
        mkAttack0('atk-alice-reforco', 'Reforço Lateral', 1, 10, [E('removeStatus', { target: 'activeAlly', status: 'all' })], '10 de dano. Purifique seu Agente Ativo.'),
        mkAttack0('atk-alice-rotacao', 'Rotação Asgard', 2, 0, [
          E('heal', { target: 'allAllies', amount: 20 }), E('drawCards', { amount: 1 })
        ], 'Cure 20 de todos os seus Agentes e compre 1 carta.')
      ]
    }),
    profile('Alice Westland', 'FINALS', { hp: 100, retreat: 1, vp: 1, rarity: 'epic', attacks: [mkAttack0('atk-alice-reforco', 'Reforço Lateral', 1, 10, [E('removeStatus', { target: 'activeAlly', status: 'all' })], '10 de dano. Purifique seu Agente Ativo.'), mkAttack0('atk-alice-rotacao', 'Rotação Asgard', 2, 0, [E('heal', { target: 'allAllies', amount: 20 }), E('drawCards', { amount: 1 })], 'Cure 20 de todos e compre 1 carta.')] }),
    profile('Tarruh', 'BASE', {
      hp: 130, retreat: 2, vp: 2, rarity: 'uncommon',
      attacks: [
        mkAttack0('atk-tarruh-linha', 'Linha de Aço', 1, 20, [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 1 })], '20 de dano. Este Agente ganha Tenacidade (−20 dano recebido).'),
        mkAttack0('atk-tarruh-parede', 'Parede de Asgard', 2, 30, [
          E('heal', { target: 'allAllies', amount: 10 }),
          E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 })
        ], '30 de dano. Cure 10 e conceda Tenacidade a todos os seus Agentes.')
      ]
    }),
    profile('Tarruh', 'FINALS', { hp: 130, retreat: 2, vp: 2, rarity: 'epic', attacks: [mkAttack0('atk-tarruh-linha', 'Linha de Aço', 1, 20, [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 1 })], '20 de dano. Tenacidade.'), mkAttack0('atk-tarruh-allin', 'All-In de Final', 2, 55, [], '55 de dano. Tudo ou nada — sem proteção.')] }),
    profile('Tayná Lannister Müller', 'BASE', {
      hp: 110, retreat: 1, vp: 1, rarity: 'uncommon',
      attacks: [
        mkAttack0('atk-tayna-corte', 'Corte de Ritmo', 1, 10, [E('applyStatus', { status: 'exhausted', tokens: 1 })], '10 de dano. Exauste o Ativo inimigo.'),
        mkAttack0('atk-tayna-fecho', 'Fecho Real', 2, 20, [
          E('applyStatus', { target: 'allEnemies', status: 'silence', tokens: 2 }),
          E('detachResource', { amount: 1, to: 'discard' })
        ], '20 de dano. Silencie TODOS os Agentes inimigos por 2 turnos e descarte 1 Energia do Ativo inimigo.')
      ]
    }),
    profile('Tayná Lannister Müller', 'FINALS', { hp: 110, retreat: 1, vp: 1, rarity: 'epic', attacks: [mkAttack0('atk-tayna-fechamento', 'Fechamento de Final', 1, 15, [E('applyStatus', { status: 'silence', tokens: 2 })], '15 de dano. Silencia o Ativo inimigo por 2 turnos.'), mkAttack0('atk-tayna-fecho', 'Fecho Real', 2, 20, [E('applyStatus', { target: 'allEnemies', status: 'silence', tokens: 2 }), E('detachResource', { amount: 1, to: 'discard' })], '20 de dano. Silencie todos os inimigos e descarte 1 Energia do Ativo inimigo.')] }),

    // ===== MORNING STAR ====================================================
    profile('Henry', 'BASE', {
      hp: 130, retreat: 2, vp: 2, rarity: 'uncommon',
      ability: mkAbility('ab-henry-escolta', 'Interceptação de Escolta', 'whileBench', {
        mods: { damageTakenFlat: 10 },
        text: 'Enquanto Henry está na Reserva, seus Agentes recebem 10 de dano a menos. (Escolta — passiva convertida.)'
      }),
      attacks: [
        mkAttack0('atk-henry-corredor', 'Corredor Seguro', 1, 15, [E('applyStatus', { target: 'self', status: 'tenacity', tokens: 1 })], '15 de dano. Este Agente ganha Tenacidade.'),
        mkAttack0('atk-henry-extracao', 'Extração em Cadeia', 2, 30, [E('removeStatus', { target: 'allAllies', status: 'all' }), E('heal', { target: 'allAllies', amount: 10 })], '30 de dano. Purifique e cure 10 de todos os seus Agentes.')
      ]
    }),
    // Henry não tem sidegrade curado na fonte (CURATED_ROSTER_v0.1) — apenas BASE.
    profile('Mik Kashnov', 'BASE', {
      hp: 100, retreat: 1, vp: 1, rarity: 'uncommon',
      attacks: [
        mkAttack0('atk-mik-pulso', 'Pulso de Retorno', 1, 10, [E('heal', { target: 'activeAlly', amount: 20 })], '10 de dano. Cure 20 do seu Agente Ativo.'),
        mkAttack0('atk-mik-malha', 'Malha Morning Star', 2, 0, [
          E('heal', { target: 'allAllies', amount: 20 }), E('drawCards', { amount: 1 }),
          E('conditionalEffect', { condition: { op: 'vpCompare', compare: 'less' }, then: [E('drawCards', { amount: 1 })] })
        ], 'Cure 20 de todos os seus Agentes e compre 1 carta (2 se estiver perdendo em PV).')
      ]
    }),
    profile('Mik Kashnov', 'ICON', { hp: 100, retreat: 1, vp: 1, rarity: 'legendary', attacks: [mkAttack0('atk-mik-icone', 'Ícone de Campo', 1, 10, [E('applyStatus', { status: 'silence', tokens: 2 })], '10 de dano. Silencia o Ativo inimigo por 2 turnos.'), mkAttack0('atk-mik-malha', 'Malha Morning Star', 2, 0, [E('heal', { target: 'allAllies', amount: 20 }), E('drawCards', { amount: 1 })], 'Cure 20 de todos e compre 1 carta.')] }),
    profile('Ryan Smith', 'BASE', {
      hp: 110, retreat: 1, vp: 1, rarity: 'uncommon',
      attacks: [
        mkAttack0('atk-ryan-linha', 'Linha de Comando', 1, 10, [
          E('removeStatus', { target: 'activeAlly', status: 'all' }),
          E('conditionalEffect', { condition: { op: 'vpCompare', compare: 'less' }, then: [E('drawCards', { amount: 1 })] })
        ], '10 de dano. Purifique seu Ativo. Se estiver perdendo em PV, compre 1 carta.'),
        mkAttack0('atk-ryan-todos', 'Todos de Pé', 2, 0, [
          E('heal', { target: 'allAllies', amount: 20 }),
          E('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 }),
          E('conditionalEffect', { condition: { op: 'vpCompare', compare: 'less' }, then: [E('drawCards', { amount: 1 })] })
        ], 'Cure 20 e conceda Tenacidade a todos os seus Agentes. Perdendo em PV: compre 1 carta.')
      ]
    }),
    profile('Ryan Smith', 'CHAMPION', { hp: 110, retreat: 1, vp: 1, rarity: 'epic', attacks: [mkAttack0('atk-ryan-linha', 'Linha de Comando', 1, 10, [E('removeStatus', { target: 'activeAlly', status: 'all' })], '10 de dano. Purifique seu Ativo.'), mkAttack0('atk-ryan-campeao', 'Comando de Campeão', 2, 0, [E('heal', { target: 'allAllies', amount: 30 }), E('drawCards', { amount: 2 })], 'Cure 30 de todos e compre 2 cartas.')] }),
    profile('Saki', 'BASE', {
      hp: 110, retreat: 1, vp: 2, rarity: 'rare',
      attacks: [
        mkAttack0('atk-saki-fissura', 'Fissura de Cobrança', 1, 20, [
          E('applyStatus', { status: 'marked', tokens: 2 }),
          E('conditionalEffect', { condition: { op: 'hasStatus', status: 'marked', target: 'defender' }, then: [E('detachResource', { amount: 1, to: 'discard' }), E('removeStatus', { status: 'marked' })] })
        ], '20 de dano e Marca o Ativo inimigo (2 turnos). Se ele já estava Marcado: descarte 1 das suas Energias e consuma a Marca.')
      ],
      ability: undefined
    }),
    profile('Saki', 'CHAMPION', { hp: 110, retreat: 1, vp: 2, rarity: 'epic', attacks: [mkAttack0('atk-saki-fissura', 'Fissura de Cobrança', 1, 20, [E('applyStatus', { status: 'marked', tokens: 2 })], '20 de dano e Marca o Ativo inimigo.'), mkAttack0('atk-saki-abalo', 'Abalo Final', 2, 30, [E('applyStatus', { status: 'silence', tokens: 2 }), E('applyStatus', { target: 'allEnemies', status: 'exhausted', tokens: 1 })], '30 de dano. Silencie o Ativo inimigo e Exauste todos os inimigos.')] }),

    // ===== BASTARD GRAN TUBARÕES XYZ =======================================
    profile('Kaio', 'BASE', {
      hp: 110, retreat: 1, vp: 2, rarity: 'rare',
      attacks: [
        mkAttack0('atk-kaio-ruptura', 'Ruptura Violeta', 1, 20, [E('applyStatus', { status: 'marked', tokens: 2 })], '20 de dano e Marca o Ativo inimigo por 2 turnos.'),
        mkAttack0('atk-kaio-colapso', 'Colapso em Cadeia', 2, 40, [
          E('applyStatus', { status: 'exhausted', tokens: 1 }),
          E('conditionalEffect', { condition: { op: 'hasStatus', status: 'marked', target: 'defender' }, then: [E('detachResource', { amount: 1, to: 'discard' }), E('removeStatus', { status: 'marked' })] })
        ], '40 de dano. Exauste o Ativo inimigo. Se ele estava Marcado: descarte 1 das suas Energias e consuma a Marca.')
      ]
    }),
    profile('Ruby', 'BASE', {
      hp: 100, retreat: 1, vp: 1, rarity: 'common',
      ability: mkAbility('ab-ruby-palco', 'Palco sem Testemunhas', 'activated', {
        zone: 'any', oncePerTurn: true, cost: [],
        effects: [E('conditionalEffect', { condition: { op: 'benchAtMost', value: 0 }, then: [E('drawCards', { amount: 1 })] })],
        text: 'Uma vez por turno: se Ruby for sua única Agente em campo, compre 1 carta. (Duelista solo — passiva convertida.)'
      }),
      attacks: [
        mkAttack0('atk-ruby-finta', 'Finta Rubra', 1, 10, [E('applyStatus', { status: 'marked', tokens: 2 })], '10 de dano e Marca o Ativo inimigo por 2 turnos.'),
        mkAttack0('atk-ruby-tudo', 'Tudo no Vermelho', 2, 40, [
          E('applyStatus', { status: 'root', tokens: 1 }),
          E('conditionalEffect', { condition: { op: 'hasStatus', status: 'marked', target: 'defender' }, then: [E('dealDamage', { target: 'defender', amount: 10 }), E('removeStatus', { status: 'marked' })] })
        ], '40 de dano. Imobiliza o Ativo inimigo (não recua). Se ele estava Marcado: +10 de dano e consome a Marca.')
      ]
    }),

    // ===== RAINBOW SIX =====================================================
    profile('Wei Fang', 'BASE', {
      hp: 110, retreat: 2, vp: 1, rarity: 'uncommon',
      attacks: [
        mkAttack0('atk-weifang-corte', 'Corte de Canal', 1, 10, [E('applyStatus', { status: 'exhausted', tokens: 1 }), E('detachResource', { amount: 1, to: 'discard' })], '10 de dano. Exauste o Ativo inimigo e descarte 1 das suas Energias.'),
        mkAttack0('atk-weifang-blackout', 'Blackout Tático', 2, 30, [E('applyStatus', { status: 'silence', tokens: 2 }), E('detachResource', { amount: 1, to: 'discard' })], '30 de dano. Silencie o Ativo inimigo (2 turnos) e descarte 1 das suas Energias.')
      ]
    }),
    profile('Wei Wang', 'BASE', {
      hp: 110, retreat: 1, vp: 1, rarity: 'rare',
      attacks: [
        mkAttack0('atk-weiwang-interdicao', 'Interdição', 1, 10, [E('applyStatus', { status: 'marked', tokens: 2 })], '10 de dano e Marca o Ativo inimigo por 2 turnos.'),
        mkAttack0('atk-weiwang-zona', 'Zona Morta', 2, 30, [
          E('applyStatus', { status: 'stun', tokens: 1 }),
          E('conditionalEffect', { condition: { op: 'hasStatus', status: 'marked', target: 'defender' }, then: [E('applyStatus', { status: 'root', tokens: 1 }), E('removeStatus', { status: 'marked' })] })
        ], '30 de dano e Atordoa o Ativo inimigo. Se ele estava Marcado: também o Imobiliza e consome a Marca.')
      ]
    }),
    profile('Wei Wang', 'MVP', { hp: 110, retreat: 1, vp: 1, rarity: 'rare', attacks: [mkAttack0('atk-weiwang-interdicao', 'Interdição', 1, 10, [E('applyStatus', { status: 'marked', tokens: 2 })], '10 de dano e Marca o Ativo inimigo.'), mkAttack0('atk-weiwang-mvp-lock', 'MVP Lock', 2, 40, [E('applyStatus', { status: 'silence', tokens: 2 }), E('detachResource', { amount: 1, to: 'discard' })], '40 de dano. Silencia o Ativo inimigo e descarte 1 das suas Energias.')] }),

    // ===== SALVATORE / PLATINUM / WEIGON ===================================
    profile('Hashika Gloves', 'BASE', {
      hp: 100, retreat: 1, vp: 1, rarity: 'rare',
      ability: mkAbility('ab-hashika-caca', 'Predador à Vista', 'activated', {
        zone: 'any', oncePerTurn: true, cost: [],
        effects: [E('conditionalEffect', { condition: { op: 'hasStatus', status: 'marked', target: 'enemyActive' }, then: [E('drawCards', { amount: 1 })] })],
        text: 'Uma vez por turno: se o Ativo inimigo estiver Marcado, compre 1 carta. (Caçada — passiva convertida.)'
      }),
      attacks: [
        mkAttack0('atk-hashika-rastro', 'Rastro de Corte', 1, 10, [E('applyStatus', { status: 'marked', tokens: 2 })], '10 de dano e Marca o Ativo inimigo por 2 turnos.'),
        mkAttack0('atk-hashika-quarto', 'Quarto Fechado', 2, 40, [
          E('applyStatus', { status: 'silence', tokens: 2 }),
          E('conditionalEffect', { condition: { op: 'hasStatus', status: 'marked', target: 'defender' }, then: [E('applyStatus', { status: 'root', tokens: 1 }), E('removeStatus', { status: 'marked' })] })
        ], '40 de dano. Silencia o Ativo inimigo. Se ele estava Marcado: também o Imobiliza e consome a Marca.')
      ]
    }),
    profile('Baek Seo-jin', 'BASE', {
      hp: 110, retreat: 1, vp: 1, rarity: 'uncommon',
      attacks: [
        mkAttack0('atk-baek-fantasma', 'Interferência Fantasma', 1, 10, [E('applyStatus', { status: 'silence', tokens: 2 })], '10 de dano. Silencia o Ativo inimigo por 2 turnos.'),
        mkAttack0('atk-baek-lockdown', 'Lockdown Neural', 2, 30, [E('applyStatus', { status: 'silence', tokens: 2 }), E('applyStatus', { status: 'stun', tokens: 1 })], '30 de dano. Silencia e Atordoa o Ativo inimigo.')
      ]
    }),
    profile('Olivia Mih', 'BASE', {
      hp: 130, retreat: 2, vp: 2, rarity: 'uncommon',
      attacks: [
        mkAttack0('atk-olivia-retorno', 'Ponto de Retorno', 1, 10, [
          E('removeStatus', { target: 'self', status: 'all' }),
          E('applyStatus', { target: 'self', status: 'tenacity', tokens: 1 })
        ], '10 de dano. Purifica-se e ganha Tenacidade.'),
        mkAttack0('atk-olivia-estabilidade', 'Campo de Estabilidade', 2, 20, [
          E('removeStatus', { target: 'allAllies', status: 'all' }),
          E('heal', { target: 'allAllies', amount: 20 })
        ], '20 de dano. Purifica e cura 20 de todos os seus Agentes.')
      ]
    })
  ].map((p) => [profileKey(p.agentId, p.edition), p])
);

/** Attack builder local (custo genérico Energia JET). */
function mkAttack0(
  id: string, name: string, cost: number, damage: number, effects: ReturnType<typeof mkEffect>[], text: string
): AttackDef {
  return mkAttack(id, name, [['*', cost]], damage, { effects, text });
}
