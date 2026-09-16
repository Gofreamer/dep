import type { EquipmentDef } from '../../engine/types';
import { FX, equip, grantAttack } from './builders';

/**
 * EQUIPAMENTOS JET — cartas conectadas a Agentes. Finishers de 4–5 Energias
 * vivem aqui via `grantsAttacks` (investimento real de Energia → recompensa),
 * nunca em agentes (a fonte oficial não fornece esses ataques). Conteúdo
 * gameplay-original do TCG, não apresentado como lore canônico.
 */
export const JET_EQUIPMENT: EquipmentDef[] = [
  // ---- Genérico (linha de base) -------------------------------------------
  equip('jeq-manopla', 'Manopla Reforçada', {
    text: 'O Agente conectado causa +10 de dano.', rarity: 'common',
    mods: { damageDealtFlat: 10 }
  }),
  equip('jeq-placa', 'Placa de Impacto', {
    text: 'O Agente conectado reduz 10 de dano recebido.', rarity: 'common',
    mods: { damageTakenFlat: 10 }
  }),
  equip('jeq-propulsor', 'Propulsor de Recuo', {
    text: 'O Agente conectado recusta com 1 Energia a menos.', rarity: 'uncommon',
    mods: { retreatCostMod: -1 }
  }),
  equip('jeq-nucleo-hp', 'Núcleo Vital', {
    text: 'O Agente conectado ganha +30 de HP máximo.', rarity: 'rare',
    mods: { statBonusHp: 30 }
  }),
  equip('jeq-ampulheta', 'Ampulheta Tática', {
    text: 'No início do seu turno: 50% de chance de comprar 1 carta.', rarity: 'rare',
    triggers: [{
      id: 'tr-ampulheta', name: 'Ritmo', trigger: 'turnStart', oncePerTurn: true,
      effects: [FX('coinFlip', { chance: 0.5, then: [FX('drawCards', { amount: 1 })], label: 'Ritmo' })],
      text: 'No início do seu turno: 50% de chance de comprar 1 carta.'
    }]
  }),

  // ---- Aggro (KOF 12) -----------------------------------------------------
  equip('jeq-lamina-rubra', 'Lâmina Rubra', {
    text: 'O Agente conectado causa +15 de dano.', rarity: 'uncommon', faction: 'kof-12', tags: ['equipamento', 'aggro'],
    mods: { damageDealtFlat: 15 }
  }),
  equip('jeq-impulso-kof', 'Impulso KOF', {
    text: 'O Agente conectado ataca com 1 Energia a menos (mínimo 1; não empilha com outros redutores).', rarity: 'rare', faction: 'kof-12', tags: ['equipamento', 'aggro'],
    mods: { attackCostReduce: 1 }
  }),
  equip('jeq-ultimato-kof', 'Ultimato KOF', {
    text: 'Concede “Impacto KOF”: 5 Energias, 180 de dano, sofre 20 de dano de recuo. OHKO exige setup completo.', rarity: 'legendary', faction: 'kof-12', tags: ['equipamento', 'finisher'],
    grantsAttacks: [
      grantAttack('atk-jeq-ultimato-kof', 'Impacto KOF', 5, 180,
        '5 Energias · 180 de dano. Sofre 20 de dano de recuo.',
        { selfDamage: 20, tags: ['finisher'] })
    ]
  }),

  // ---- Controle (Asgard) --------------------------------------------------
  equip('jeq-casco', 'Casco de Bastião', {
    text: 'O Agente conectado reduz 15 de dano recebido.', rarity: 'uncommon', faction: 'asgard', tags: ['equipamento', 'controle'],
    mods: { damageTakenFlat: 15 }
  }),
  equip('jeq-bastiao-asgard', 'Bastião de Asgard', {
    text: 'Concede “Muralha Final”: 4 Energias, 60 de dano, cura 40 de todos os seus Agentes e ganha Tenacidade.', rarity: 'legendary', faction: 'asgard', tags: ['equipamento', 'finisher', 'controle'],
    grantsAttacks: [
      grantAttack('atk-jeq-bastiao-asgard', 'Muralha Final', 4, 60,
        '4 Energias · 60 de dano. Cura 40 de todos os seus Agentes e você ganha Tenacidade por 2 turnos.',
        { effects: [FX('heal', { target: 'allAllies', amount: 40 }), FX('applyStatus', { target: 'self', status: 'tenacity', tokens: 2 })] })
    ]
  }),

  // ---- Midrange (Morning Star) -------------------------------------------
  equip('jeq-visao', 'Visão de Mercado', {
    text: 'No início do seu turno, compre 1 carta.', rarity: 'rare', faction: 'morning-star', tags: ['equipamento', 'midrange'],
    triggers: [{
      id: 'tr-visao', name: 'Visão de Mercado', trigger: 'turnStart', oncePerTurn: true,
      effects: [FX('drawCards', { amount: 1 })],
      text: 'No início do seu turno: compre 1 carta.'
    }]
  }),
  equip('jeq-comunicador', 'Comunicador de Comando', {
    text: 'No fim do seu turno, compre 1 carta.', rarity: 'uncommon', faction: 'morning-star', tags: ['equipamento', 'midrange'],
    triggers: [{
      id: 'tr-comunicador', name: 'Rede de Comando', trigger: 'turnEnd', oncePerTurn: true,
      effects: [FX('drawCards', { amount: 1 })],
      text: 'No fim do seu turno: compre 1 carta.'
    }]
  }),
  equip('jeq-comando-ms', 'Comando Total', {
    text: 'Concede “Comando Total”: 5 Energias, 120 de dano, compre 3 cartas.', rarity: 'legendary', faction: 'morning-star', tags: ['equipamento', 'finisher', 'midrange'],
    grantsAttacks: [
      grantAttack('atk-jeq-comando-ms', 'Comando Total', 5, 120,
        '5 Energias · 120 de dano. Compre 3 cartas.',
        { effects: [FX('drawCards', { amount: 3 })] })
    ]
  }),

  // ---- Burst (Bastard Gran Tubarões XYZ) ----------------------------------
  equip('jeq-cristal', 'Cristal de Impacto', {
    text: 'O Agente conectado causa +20 de dano e reduz 10 do dano recebido.', rarity: 'rare', faction: 'bastard-gran-tubaroes-xyz', tags: ['equipamento', 'burst'],
    mods: { damageDealtFlat: 20, damageTakenFlat: 10 }
  }),
  equip('jeq-colisao-tubarao', 'Colisão Tubarão', {
    text: 'Concede “Colisão Tubarão”: 4 Energias, 140 de dano, ignora Resistência.', rarity: 'legendary', faction: 'bastard-gran-tubaroes-xyz', tags: ['equipamento', 'finisher', 'burst'],
    grantsAttacks: [
      grantAttack('atk-jeq-colisao-tubarao', 'Colisão Tubarão', 4, 140,
        '4 Energias · 140 de dano. Ignora Resistência.',
        { ignoreResistance: true })
    ]
  }),

  // ---- Disrupção (Rainbow Six) -------------------------------------------
  equip('jeq-gerador', 'Gerador de Interferência', {
    text: 'O Agente conectado ataca com 1 Energia a menos (mínimo 1; não empilha com outros redutores).', rarity: 'rare', faction: 'rainbow-six', tags: ['equipamento', 'disrupção'],
    mods: { attackCostReduce: 1 }
  }),
  equip('jeq-reflexo-r6', 'Reflexos de Operação', {
    text: 'Concede “Tiro de Cobertura”: 1 Energia, 20 de dano.', rarity: 'common', faction: 'rainbow-six', tags: ['equipamento', 'disrupção'],
    grantsAttacks: [
      grantAttack('atk-jeq-reflexo-r6', 'Tiro de Cobertura', 1, 20, '1 Energia · 20 de dano.')
    ]
  }),
  equip('jeq-protocolo-r6', 'Protocolo Blackout', {
    text: 'Concede “Blackout Total”: 5 Energias, 60 de dano, Silencia e Atordoa o Ativo inimigo.', rarity: 'legendary', faction: 'rainbow-six', tags: ['equipamento', 'finisher', 'disrupção'],
    grantsAttacks: [
      grantAttack('atk-jeq-protocolo-r6', 'Blackout Total', 5, 60,
        '5 Energias · 60 de dano. Silencia e Atordoa o Ativo inimigo.',
        { effects: [FX('applyStatus', { status: 'silence', tokens: 2 }), FX('applyStatus', { status: 'stun', tokens: 1 })] })
    ]
  }),

  // ---- Tempo (Platinum) ---------------------------------------------------
  equip('jeq-luneta', 'Luneta de Precisão', {
    text: 'O Agente conectado causa +10 de dano e recusta com 1 Energia a menos.', rarity: 'uncommon', faction: 'platinum', tags: ['equipamento', 'tempo'],
    mods: { damageDealtFlat: 10, retreatCostMod: -1 }
  }),
  equip('jeq-precisao-plat', 'Protocolo de Precisão', {
    text: 'Concede “Tiro Decisivo”: 4 Energias, 150 de dano, ignora Resistência.', rarity: 'legendary', faction: 'platinum', tags: ['equipamento', 'finisher', 'tempo'],
    grantsAttacks: [
      grantAttack('atk-jeq-precisao-plat', 'Tiro Decisivo', 4, 150,
        '4 Energias · 150 de dano. Ignora Resistência.',
        { ignoreResistance: true })
    ]
  }),

  // ---- Sustain (Weigon) ---------------------------------------------------
  equip('jeq-mochila', 'Mochila de Suprimentos', {
    text: 'Curas recebidas pelo Agente conectado curam 15 a mais.', rarity: 'uncommon', faction: 'weigon', tags: ['equipamento', 'sustain'],
    mods: { healFlat: 15 }
  }),
  equip('jeq-essencia', 'Essência Vital', {
    text: 'Quando o Agente conectado é curado, compre 1 carta (1× por turno).', rarity: 'rare', faction: 'weigon', tags: ['equipamento', 'sustain'],
    triggers: [{
      id: 'tr-essencia', name: 'Essência Vital', trigger: 'onHealed', oncePerTurn: true,
      effects: [FX('drawCards', { amount: 1 })],
      text: 'Quando o Agente conectado é curado: compre 1 carta (1× por turno).'
    }]
  }),
  equip('jeq-ancora-weigon', 'Âncora Final', {
    text: 'Concede “Âncora Final”: 5 Energias, 100 de dano, cura 60 do Agente conectado.', rarity: 'legendary', faction: 'weigon', tags: ['equipamento', 'finisher', 'sustain'],
    grantsAttacks: [
      grantAttack('atk-jeq-ancora-weigon', 'Âncora Final', 5, 100,
        '5 Energias · 100 de dano. Cura 60 do Agente conectado.',
        { effects: [FX('heal', { target: 'self', amount: 60 })] })
    ]
  }),

  // ---- Combo (Salvatore) --------------------------------------------------
  equip('jeq-luva-rapida', 'Luva de Caçador', {
    text: 'O Agente conectado causa +5 de dano e recusta com 1 Energia a menos.', rarity: 'common', faction: 'salvatore', tags: ['equipamento', 'combo'],
    mods: { damageDealtFlat: 5, retreatCostMod: -1 }
  }),
  equip('jeq-cacada-salv', 'Caçada Final', {
    text: 'Concede “Caçada Final”: 4 Energias, 130 de dano, +20 se o alvo estiver Marcado.', rarity: 'legendary', faction: 'salvatore', tags: ['equipamento', 'finisher', 'combo'],
    grantsAttacks: [
      grantAttack('atk-jeq-cacada-salv', 'Caçada Final', 4, 130,
        '4 Energias · 130 de dano. +20 se o alvo estiver Marcado.',
        {
          effects: [FX('conditionalEffect', {
            condition: { op: 'hasStatus', status: 'marked', target: 'defender' },
            then: [FX('dealDamage', { target: 'defender', amount: 20, label: 'Presas Marcadas' })]
          })]
        })
    ]
  })
];
