import type { CardDef, EquipmentDef, EffectStep } from '../../engine/types';

const E = (op: string, params: Record<string, unknown> = {}): EffectStep => ({ op, ...params });

const EQ = (id: string, name: string, rarity: EquipmentDef['rarity'], o: { text?: string; mods?: EquipmentDef['mods']; triggers?: EquipmentDef['triggers']; grantsAttacks?: EquipmentDef['grantsAttacks']; tags?: string[] } = {}): EquipmentDef => ({
  id,
  kind: 'EQUIPMENT',
  name,
  text: o.text,
  faction: 'neutro',
  rarity,
  tags: o.tags ?? ['equipamento'],
  art: { motif: 'equipment', seed: id },
  mods: o.mods,
  triggers: o.triggers,
  grantsAttacks: o.grantsAttacks
});

/**
 * Equipamentos — persistentes, conectados a personagens (limite configurável).
 */
export const EQUIPMENT: EquipmentDef[] = [
  EQ('eq-lamina', 'Lâmina Sônica', 'common', { mods: { damageDealtFlat: 20 }, text: 'Ataques causam +20 de dano.' }),
  EQ('eq-garras', 'Garras Afiadas', 'common', { mods: { damageDealtFlat: 10 }, text: 'Ataques causam +10 de dano.' }),
  EQ('eq-escamas', 'Escamas de Aço', 'common', { mods: { damageTakenFlat: 20 }, text: 'Recebe 20 menos de dano.' }),
  EQ('eq-amuleto', 'Amuleto Vital', 'uncommon', {
    triggers: [{ id: 'tr-amuleto', name: 'Pulso Vital', trigger: 'turnEnd', effects: [E('heal', { target: 'self', amount: 10 })], text: 'Fim do turno: cura 10.' }],
    text: 'Fim do turno: cura 10.'
  }),
  EQ('eq-botas', 'Botas do Vento', 'common', { mods: { retreatCostMod: -1 }, text: 'Custa 1 recurso a menos para recuar (mínimo 0).' }),
  EQ('eq-foco', 'Foco de Mira', 'uncommon', { mods: { attackCostReduce: 1 }, text: 'Ataques custam 1 recurso neutro a menos.' }),
  EQ('eq-oraculo', 'Elmo Oracular', 'rare', {
    triggers: [{ id: 'tr-oraculo', name: 'Visão do Oráculo', trigger: 'turnStart', oncePerTurn: true, effects: [E('drawCards', { amount: 1 })], text: 'Início do turno: compre 1 carta.' }],
    text: 'Início do turno: compre 1 carta.'
  }),
  EQ('eq-selo', 'Selo Silencioso', 'uncommon', {
    mods: { statusImmune: ['poison', 'burn', 'sleep', 'confusion', 'stun', 'silence'] },
    text: 'Imune a Veneno, Queimadura, Sono, Confusão, Atordoamento e Silêncio.'
  }),
  EQ('eq-canhao', 'Canhão Portátil', 'uncommon', {
    grantsAttacks: [{ id: 'atk-canhao-tiro', name: 'Tiro de Suporte', cost: [], damage: 20, text: '20 de dano. Não custa recursos.' }],
    text: 'Concede o ataque "Tiro de Suporte" (20, sem custo).'
  }),
  EQ('eq-manto', 'Manto de Espelhos', 'uncommon', { mods: { damageTakenFromAffinity: { affinity: 'solar', flat: 20 } }, text: 'Recebe 20 menos de dano de ataques Solar.' }),
  EQ('eq-ressoador', 'Núcleo Ressonante', 'rare', {
    triggers: [{ id: 'tr-resso', name: 'Ressonância', trigger: 'onPlay', effects: [E('drawCards', { amount: 1 })], text: 'Ao ser conectado: compre 1 carta.' }],
    text: 'Ao ser conectado: compre 1 carta.'
  }),
  EQ('eq-coroa', 'Coroa do Comandante', 'rare', {
    triggers: [{ id: 'tr-coroa', name: 'Liderança', trigger: 'onAllyDefeated', oncePerTurn: true, effects: [E('drawCards', { amount: 1 })], text: 'Quando um personagem é derrotado: compre 1 carta (1x por turno).' }],
    text: 'Quando qualquer personagem é derrotado: compre 1 carta (1x por turno).'
  })
];

export const EQUIPMENT_CARDS: CardDef[] = EQUIPMENT;
