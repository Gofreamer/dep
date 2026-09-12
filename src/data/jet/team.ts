import type { CardDef } from '../../engine/types';
import { FX, tech, equip } from './builders';

/**
 * CARTAS DE EQUIPE / SINERGIA JET — táticas que só funcionam quando a equipe
 * correspondente está em campo (restriction `factionInPlay`). Conteúdo
 * gameplay-original do TCG (cartas táticas/equipe), nunca apresentado como
 * lore canônico. A identidade de cada equipe vira plano de jogo.
 */
export const JET_TEAM: CardDef[] = [
  // ===== KOF 12 — pressão agressiva (3) ====================================
  tech('jsyn-kof-furia', 'Fúria KOF', [
    FX('applyStatus', { target: 'enemyActive', status: 'marked', tokens: 2 }),
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Fúria KOF' })
  ], {
    text: 'Marque o Ativo inimigo por 2 turnos e cause 10 de dano. Requer um Agente KOF 12 em campo.',
    rarity: 'rare', faction: 'kof-12', tags: ['equipe', 'aggro'],
    restrictions: [{ type: 'factionInPlay', faction: 'kof-12' }]
  }),
  tech('jsyn-kof-ritmo', 'Ritmo de Vitória', [
    FX('increaseDamage', { target: 'activeAlly', amount: 20, label: 'Ritmo de Vitória' }),
    FX('drawCards', { amount: 1 })
  ], {
    text: 'O próximo ataque do seu Ativo causa +20 de dano neste turno e você compra 1 carta. Requer um Agente KOF 12 em campo.',
    rarity: 'uncommon', faction: 'kof-12', tags: ['equipe', 'aggro'],
    restrictions: [{ type: 'factionInPlay', faction: 'kof-12' }]
  }),
  tech('jsyn-kof-troca-relampago', 'Troca-Relâmpago', [
    FX('switchActive'),
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Troca-Relâmpago' })
  ], {
    text: 'Troque seu Ativo (sem pagar recuo) e cause 10 de dano ao Ativo inimigo. Requer um Agente KOF 12 em campo.',
    rarity: 'uncommon', faction: 'kof-12', tags: ['equipe', 'manobra'],
    restrictions: [{ type: 'factionInPlay', faction: 'kof-12' }]
  }),

  // ===== Asgard — fortaleza (3) ============================================
  tech('jsyn-asgard-baluarte', 'Baluarte', [
    FX('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 2 })
  ], {
    text: 'Conceda Tenacidade (−20 de dano recebido) a todos os seus Agentes por 2 turnos. Requer um Agente Asgard em campo.',
    rarity: 'rare', faction: 'asgard', tags: ['equipe', 'controle'],
    restrictions: [{ type: 'factionInPlay', faction: 'asgard' }]
  }),
  tech('jsyn-asgard-reconforto', 'Reconforto de Asgard', [
    FX('heal', { target: 'allAllies', amount: 40 }),
    FX('removeStatus', { target: 'allAllies', status: 'all' })
  ], {
    text: 'Cure 40 e purifique todos os seus Agentes. Requer um Agente Asgard em campo.',
    rarity: 'rare', faction: 'asgard', tags: ['equipe', 'controle'],
    restrictions: [{ type: 'factionInPlay', faction: 'asgard' }]
  }),
  tech('jsyn-asgard-muralha-gelo', 'Muralha de Gelo', [
    FX('reduceDamage', { target: 'allAllies', amount: 30, label: 'Muralha de Gelo' })
  ], {
    text: 'Todos os seus Agentes recebem 30 de dano a menos neste turno. Requer um Agente Asgard em campo.',
    rarity: 'uncommon', faction: 'asgard', tags: ['equipe', 'controle'],
    restrictions: [{ type: 'factionInPlay', faction: 'asgard' }]
  }),

  // ===== Morning Star — comando (3) ========================================
  tech('jsyn-ms-moral', 'Moral em Alta', [
    FX('drawCards', { amount: 2 }),
    FX('heal', { target: 'allAllies', amount: 10 })
  ], {
    text: 'Compre 2 cartas e cure 10 de todos os seus Agentes. Requer um Agente Morning Star em campo.',
    rarity: 'uncommon', faction: 'morning-star', tags: ['equipe', 'midrange'],
    restrictions: [{ type: 'factionInPlay', faction: 'morning-star' }]
  }),
  tech('jsyn-ms-logistica', 'Logística de Guerra', [
    FX('searchDeck', { amount: 1, filter: { kinds: ['RESOURCE', 'EQUIPMENT'] }, to: 'hand', prompt: 'Escolha uma carta de recurso ou equipamento' })
  ], {
    text: 'Busque 1 Energia ou Equipamento no baralho e coloque na mão. Requer um Agente Morning Star em campo.',
    rarity: 'uncommon', faction: 'morning-star', tags: ['equipe', 'midrange'],
    restrictions: [{ type: 'factionInPlay', faction: 'morning-star' }]
  }),
  tech('jsyn-ms-rede', 'Rede de Comando', [
    FX('attachResource', { target: 'benchAlly', amount: 1, from: 'hand' }),
    FX('drawCards', { amount: 1 })
  ], {
    text: 'Conecte 1 Energia da mão a um Agente da Reserva e compre 1 carta. Requer um Agente Morning Star em campo.',
    rarity: 'rare', faction: 'morning-star', tags: ['equipe', 'midrange'],
    restrictions: [{ type: 'factionInPlay', faction: 'morning-star' }]
  }),

  // ===== Bastard Gran Tubarões XYZ — burst (3) =============================
  tech('jsyn-tub-frenesi', 'Frenesi Tubarão', [
    FX('dealDamage', { target: 'enemyActive', amount: 20, label: 'Frenesi' }),
    FX('applyStatus', { target: 'enemyActive', status: 'marked', tokens: 1 })
  ], {
    text: 'Cause 20 de dano e marque o Ativo inimigo. Requer um Agente Tubarão em campo.',
    rarity: 'rare', faction: 'bastard-gran-tubaroes-xyz', tags: ['equipe', 'burst'],
    restrictions: [{ type: 'factionInPlay', faction: 'bastard-gran-tubaroes-xyz' }]
  }),
  tech('jsyn-tub-isca', 'Isca Viva', [
    FX('applyStatus', { target: 'activeAlly', status: 'tenacity', tokens: 2 }),
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Isca Viva' })
  ], {
    text: 'Seu Ativo ganha Tenacidade por 2 turnos e causa 10 de dano. Requer um Agente Tubarão em campo.',
    rarity: 'uncommon', faction: 'bastard-gran-tubaroes-xyz', tags: ['equipe', 'burst'],
    restrictions: [{ type: 'factionInPlay', faction: 'bastard-gran-tubaroes-xyz' }]
  }),
  tech('jsyn-tub-cacada-em-grupo', 'Caçada em Grupo', [
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Caçada em Grupo' }),
    FX('conditionalEffect', {
      condition: { op: 'benchAtLeast', value: 2, side: 'source' },
      then: [FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Caçada em Grupo' })]
    })
  ], {
    text: 'Cause 10 de dano ao Ativo inimigo; +10 se você tiver 2+ Agentes na Reserva. Requer um Agente Tubarão em campo.',
    rarity: 'uncommon', faction: 'bastard-gran-tubaroes-xyz', tags: ['equipe', 'burst'],
    restrictions: [{ type: 'factionInPlay', faction: 'bastard-gran-tubaroes-xyz' }]
  }),

  // ===== Rainbow Six — negação (3) =========================================
  tech('jsyn-r6-interceptacao', 'Interceptação', [
    FX('detachResource', { target: 'enemyActive', amount: 1, to: 'discard' }),
    FX('applyStatus', { target: 'enemyActive', status: 'silence', tokens: 1 })
  ], {
    text: 'Descarte 1 Energia do Ativo inimigo e o Silencie por 1 turno. Requer um Agente Rainbow Six em campo.',
    rarity: 'rare', faction: 'rainbow-six', tags: ['equipe', 'disrupção'],
    restrictions: [{ type: 'factionInPlay', faction: 'rainbow-six' }]
  }),
  tech('jsyn-r6-cerco', 'Cerco Tático', [
    FX('applyStatus', { target: 'enemyActive', status: 'root', tokens: 2 }),
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Cerco Tático' })
  ], {
    text: 'Imobilize o Ativo inimigo por 2 turnos e cause 10 de dano. Requer um Agente Rainbow Six em campo.',
    rarity: 'uncommon', faction: 'rainbow-six', tags: ['equipe', 'disrupção'],
    restrictions: [{ type: 'factionInPlay', faction: 'rainbow-six' }]
  }),
  tech('jsyn-r6-supressao', 'Supressão', [
    FX('applyStatus', { target: 'enemyActive', status: 'stun', tokens: 1 }),
    FX('drawCards', { amount: 1 })
  ], {
    text: 'Atordoe o Ativo inimigo e compre 1 carta. Requer um Agente Rainbow Six em campo.',
    rarity: 'rare', faction: 'rainbow-six', tags: ['equipe', 'disrupção'],
    restrictions: [{ type: 'factionInPlay', faction: 'rainbow-six' }]
  }),

  // ===== Platinum — precisão (3) ===========================================
  tech('jsyn-plat-mira', 'Mira Calibrada', [
    FX('increaseDamage', { target: 'activeAlly', amount: 25, label: 'Mira Calibrada' })
  ], {
    text: 'O próximo ataque do seu Ativo causa +25 de dano neste turno. Requer um Agente Platinum em campo.',
    rarity: 'uncommon', faction: 'platinum', tags: ['equipe', 'tempo'],
    restrictions: [{ type: 'factionInPlay', faction: 'platinum' }]
  }),
  tech('jsyn-plat-plano', 'Plano Mestre', [
    FX('drawCards', { amount: 2 }),
    FX('reduceDamage', { target: 'activeAlly', amount: 20, label: 'Plano Mestre' })
  ], {
    text: 'Compre 2 cartas e reduza em 20 o dano recebido pelo seu Ativo neste turno. Requer um Agente Platinum em campo.',
    rarity: 'rare', faction: 'platinum', tags: ['equipe', 'tempo'],
    restrictions: [{ type: 'factionInPlay', faction: 'platinum' }]
  }),
  tech('jsyn-plat-execucao', 'Execução Perfeita', [
    FX('dealDamage', { target: 'enemyActive', amount: 20, label: 'Execução Perfeita' }),
    FX('conditionalEffect', {
      condition: { op: 'turnAtLeast', turn: 6 },
      then: [FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Execução Perfeita' })]
    })
  ], {
    text: 'Cause 20 de dano ao Ativo inimigo; +10 após o turno 6. Requer um Agente Platinum em campo.',
    rarity: 'rare', faction: 'platinum', tags: ['equipe', 'tempo'],
    restrictions: [{ type: 'factionInPlay', faction: 'platinum' }]
  }),

  // ===== Weigon — âncora (3) ===============================================
  tech('jsyn-weigon-mare', 'Maré de Weigon', [
    FX('heal', { target: 'allAllies', amount: 40 }),
    FX('applyStatus', { target: 'allAllies', status: 'regeneration', tokens: 1 })
  ], {
    text: 'Cure 40 de todos os seus Agentes e conceda Regeneração por 1 turno. Requer um Agente Weigon em campo.',
    rarity: 'rare', faction: 'weigon', tags: ['equipe', 'sustain'],
    restrictions: [{ type: 'factionInPlay', faction: 'weigon' }]
  }),
  tech('jsyn-weigon-esta', 'Estabilidade', [
    FX('removeStatus', { target: 'allAllies', status: 'all' }),
    FX('heal', { target: 'allAllies', amount: 20 })
  ], {
    text: 'Purifique todos os seus Agentes e cure 20 de cada um. Requer um Agente Weigon em campo.',
    rarity: 'uncommon', faction: 'weigon', tags: ['equipe', 'sustain'],
    restrictions: [{ type: 'factionInPlay', faction: 'weigon' }]
  }),
  tech('jsyn-weigon-respiro', 'Respiro de Combate', [
    FX('heal', { target: 'activeAlly', amount: 60 }),
    FX('drawCards', { amount: 1 })
  ], {
    text: 'Cure 60 do seu Ativo e compre 1 carta. Requer um Agente Weigon em campo.',
    rarity: 'uncommon', faction: 'weigon', tags: ['equipe', 'sustain'],
    restrictions: [{ type: 'factionInPlay', faction: 'weigon' }]
  }),

  // ===== Salvatore — caçada (3) ============================================
  tech('jsyn-salv-rastro', 'Rastro do Caçador', [
    FX('applyStatus', { target: 'enemyActive', status: 'marked', tokens: 3 }),
    FX('drawCards', { amount: 1 })
  ], {
    text: 'Marque o Ativo inimigo por 3 turnos e compre 1 carta. Requer um Agente Salvatore em campo.',
    rarity: 'uncommon', faction: 'salvatore', tags: ['equipe', 'combo'],
    restrictions: [{ type: 'factionInPlay', faction: 'salvatore' }]
  }),
  tech('jsyn-salv-emboscada', 'Emboscada', [
    FX('conditionalEffect', {
      condition: { op: 'hasStatus', status: 'marked', target: 'enemyActive' },
      then: [
        FX('dealDamage', { target: 'enemyActive', amount: 30, label: 'Emboscada' }),
        FX('removeStatus', { target: 'enemyActive', status: 'marked' })
      ],
      else: [FX('dealDamage', { target: 'enemyActive', amount: 12, label: 'Emboscada' })]
    })
  ], {
    text: 'Cause 30 de dano ao Ativo inimigo se ele JÁ estava Marcado (e consuma a Marca); senão, 12 de dano. Requer um Agente Salvatore em campo.',
    rarity: 'rare', faction: 'salvatore', tags: ['equipe', 'combo'],
    restrictions: [{ type: 'factionInPlay', faction: 'salvatore' }]
  }),
  tech('jsyn-salv-espreita', 'Espreita', [
    FX('drawCards', { amount: 1 }),
    FX('reduceDamage', { target: 'activeAlly', amount: 25, label: 'Espreita' }),
    FX('increaseDamage', { target: 'activeAlly', amount: 15, label: 'Espreita' })
  ], {
    text: 'Compre 1 carta; seu Ativo recebe 25 de dano a menos e causa +15 no próximo ataque deste turno. Requer um Agente Salvatore em campo.',
    rarity: 'uncommon', faction: 'salvatore', tags: ['equipe', 'combo'],
    restrictions: [{ type: 'factionInPlay', faction: 'salvatore' }]
  }),

  // ===== Equipamento de equipe (sinergia, 1) ===============================
  equip('jeq-flamula', 'Flâmula de Equipe', {
    text: 'O Agente conectado causa +10 de dano. Requer um Agente da mesma equipe que ele em campo.',
    rarity: 'uncommon', faction: 'neutro', tags: ['equipamento', 'equipe'],
    mods: { damageDealtFlat: 10 }
  })
];
