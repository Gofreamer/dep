import type { EquipmentDef, FieldDef, ActionDef } from '../../engine/types';

/**
 * TÉCNICAS / EQUIPAMENTOS / CAMPOS auxiliares do JET CORE SET — gameplay-
 * originais com nomes neutros (Parte 17). Nada aqui afirma fato canônico do
 * universo; Expansões de Domínio por agente só quando houver informação
 * oficial suficiente (Parte 14).
 */
export const JET_TECHNIQUES: ActionDef[] = [
  {
    id: 'jact-purificacao', kind: 'ACTION', name: 'Purificação', faction: 'neutro', rarity: 'common',
    tags: ['suporte'], art: { motif: 'tecnica', seed: 'jact-7' },
    effects: [{ op: 'removeStatus', target: 'activeAlly', status: 'all' }],
    text: 'Remova todos os efeitos do seu Agente Ativo.',
    restrictions: [{ type: 'oncePerTurn' }]
  },
  {
    id: 'jact-marcacao', kind: 'ACTION', name: 'Marca Tática', faction: 'neutro', rarity: 'uncommon',
    tags: ['ofensiva'], art: { motif: 'tecnica', seed: 'jact-8' },
    effects: [{ op: 'applyStatus', target: 'enemyActive', status: 'marked', tokens: 2 }],
    text: 'O Agente Ativo inimigo fica Marcado por 2 turnos (recebe +10 de dano).',
    restrictions: [{ type: 'oncePerTurn' }]
  },
  {
    id: 'jact-recarga', kind: 'ACTION', name: 'Recarga Rápida', faction: 'neutro', rarity: 'uncommon',
    tags: ['energia'], art: { motif: 'tecnica', seed: 'jact-9' },
    effects: [{ op: 'attachResource', target: 'activeAlly', amount: 1, from: 'hand' }, { op: 'drawCards', amount: 1 }],
    text: 'Conecte 1 Energia da sua mão ao seu Agente Ativo e compre 1 carta.',
    restrictions: [{ type: 'oncePerTurn' }]
  },
  {
    id: 'jact-retomada', kind: 'ACTION', name: 'Retomada', faction: 'neutro', rarity: 'rare',
    tags: ['suporte'], art: { motif: 'tecnica', seed: 'jact-10' },
    effects: [{ op: 'retrieveFromDiscard', amount: 1, pick: 'you', reveal: true }],
    text: 'Recupere 1 carta do seu descarte para a mão.',
    restrictions: [{ type: 'oncePerTurn' }]
  },
  {
    id: 'jact-abre-espaco', kind: 'ACTION', name: 'Abre-Espaço', faction: 'neutro', rarity: 'common',
    tags: ['manobra'], art: { motif: 'tecnica', seed: 'jact-1' },
    effects: [{ op: 'switchActive' }],
    text: 'Troque seu Agente Ativo por um da Reserva (sem pagar recuo).',
    restrictions: [{ type: 'oncePerTurn' }]
  },
  {
    id: 'jact-leitura', kind: 'ACTION', name: 'Leitura de Combate', faction: 'neutro', rarity: 'common',
    tags: ['suporte'], art: { motif: 'tecnica', seed: 'jact-2' },
    effects: [{ op: 'drawCards', amount: 2 }],
    text: 'Compre 2 cartas.',
    restrictions: [{ type: 'oncePerTurn' }]
  },
  {
    id: 'jact-foco-ofensivo', kind: 'ACTION', name: 'Foco Ofensivo', faction: 'neutro', rarity: 'uncommon',
    tags: ['ofensiva'], art: { motif: 'tecnica', seed: 'jact-3' },
    effects: [{ op: 'increaseDamage', target: 'activeAlly', amount: 20, label: 'Foco Ofensivo' }],
    text: 'O próximo ataque do seu Agente Ativo causa +20 de dano neste turno.',
    restrictions: [{ type: 'oncePerTurn' }]
  },
  {
    id: 'jact-corte-energia', kind: 'ACTION', name: 'Corte de Energia', faction: 'neutro', rarity: 'uncommon',
    tags: ['disrupção'], art: { motif: 'tecnica', seed: 'jact-4' },
    effects: [{ op: 'detachResource', target: 'enemyActive', amount: 1, to: 'discard' }],
    text: 'Descarte 1 Energia JET conectada ao Agente Ativo inimigo.',
    restrictions: [{ type: 'oncePerTurn' }]
  },
  {
    id: 'jact-trincheira', kind: 'ACTION', name: 'Trincheira', faction: 'neutro', rarity: 'uncommon',
    tags: ['defesa'], art: { motif: 'tecnica', seed: 'jact-5' },
    effects: [{ op: 'reduceDamage', target: 'activeAlly', amount: 30, label: 'Trincheira' }],
    text: 'Reduza em 30 o dano recebido pelo seu Agente Ativo neste turno.',
    restrictions: [{ type: 'oncePerTurn' }]
  },
  {
    id: 'jact-rally', kind: 'ACTION', name: 'Rally de Equipe', faction: 'neutro', rarity: 'rare',
    tags: ['suporte', 'equipe'], art: { motif: 'tecnica', seed: 'jact-6' },
    effects: [
      { op: 'heal', target: 'allAllies', amount: 20 },
      { op: 'drawCards', amount: 1 }
    ],
    text: 'Cure 20 de todos os seus Agentes e compre 1 carta.',
    restrictions: [{ type: 'oncePerTurn' }]
  }
];

export const JET_EQUIPMENT: EquipmentDef[] = [
  {
    id: 'jeq-manopla', kind: 'EQUIPMENT', name: 'Manopla Reforçada', faction: 'neutro', rarity: 'common',
    tags: ['equipamento'], art: { motif: 'equipamento', seed: 'jeq-1' },
    mods: { damageDealtFlat: 10 },
    text: 'O Agente conectado causa +10 de dano.'
  },
  {
    id: 'jeq-placa', kind: 'EQUIPMENT', name: 'Placa de Impacto', faction: 'neutro', rarity: 'common',
    tags: ['equipamento'], art: { motif: 'equipamento', seed: 'jeq-2' },
    mods: { damageTakenFlat: 10 },
    text: 'O Agente conectado reduz 10 de dano recebido.'
  },
  {
    id: 'jeq-propulsor', kind: 'EQUIPMENT', name: 'Propulsor de Recuo', faction: 'neutro', rarity: 'uncommon',
    tags: ['equipamento'], art: { motif: 'equipamento', seed: 'jeq-3' },
    mods: { retreatCostMod: -1 },
    text: 'O Agente conectado recusta com 1 Energia a menos.'
  },
  {
    id: 'jeq-nucleo-hp', kind: 'EQUIPMENT', name: 'Núcleo Vital', faction: 'neutro', rarity: 'rare',
    tags: ['equipamento'], art: { motif: 'equipamento', seed: 'jeq-4' },
    mods: { statBonusHp: 30 },
    text: 'O Agente conectado ganha +30 de HP máximo.'
  },
  {
    id: 'jeq-ampulheta', kind: 'EQUIPMENT', name: 'Ampulheta Tática', faction: 'neutro', rarity: 'rare',
    tags: ['equipamento'], art: { motif: 'equipamento', seed: 'jeq-5' },
    triggers: [{
      id: 'tr-ampulheta', name: 'Ritmo', trigger: 'turnStart', oncePerTurn: true,
      effects: [{ op: 'coinFlip', chance: 0.5, then: [{ op: 'drawCards', amount: 1 }], label: 'Ritmo' }],
      text: 'No início do seu turno: 50% de chance de comprar 1 carta.'
    }],
    text: 'No início do seu turno: 50% de chance de comprar 1 carta.'
  }
];

export const JET_FIELDS: FieldDef[] = [
  {
    id: 'jfd-arena', kind: 'FIELD', name: 'Arena Oficial', faction: 'neutro', rarity: 'common',
    subtype: 'ARENA',
    tags: ['campo'], art: { motif: 'campo', seed: 'jfd-1' },
    mods: { damageDealtFlat: 0 },
    text: 'Campo padrão da liga.',
    scope: 'all'
  },
  {
    id: 'jfd-ovacao', kind: 'FIELD', name: 'Ovação da Torcida', faction: 'neutro', rarity: 'uncommon',
    subtype: 'EVENT',
    tags: ['campo', 'evento'], art: { motif: 'campo', seed: 'jfd-2' },
    onPlay: [{ op: 'drawCards', amount: 1 }],
    mods: { healFlat: 10 },
    text: 'Ao entrar em jogo, compre 1 carta. Enquanto estiver em jogo, curas curam 10 a mais.',
    scope: 'all'
  },
  {
    id: 'jfd-zona-neutra', kind: 'FIELD', name: 'Zona Neutra', faction: 'neutro', rarity: 'rare',
    subtype: 'ARENA',
    tags: ['campo'], art: { motif: 'campo', seed: 'jfd-3' },
    override: { retreatCostMod: -1 },
    text: 'Todos os Agentes recustam com 1 Energia a menos.',
    scope: 'all'
  }
];
