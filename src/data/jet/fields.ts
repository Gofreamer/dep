import type { FieldDef } from '../../engine/types';
import { FX, field } from './builders';

/**
 * CAMPOS JET — 1 campo global ativo por partida (o novo substitui o antigo,
 * que vai ao descarte). Todo campo possui onPlay, modifier, trigger, override
 * ou efeito funcional equivalente — nunca um Field vazio. Conteúdo
 * gameplay-original do TCG.
 */
export const JET_FIELDS: FieldDef[] = [
  // ---- Genérico -----------------------------------------------------------
  field('jfd-arena', 'Arena Oficial', {
    text: 'O palco clássico da liga: ataques de TODOS os Agentes causam +5 de dano.', rarity: 'common',
    subtype: 'ARENA', tags: ['campo'],
    mods: { damageDealtFlat: 5 }, scope: 'all'
  }),
  field('jfd-ovacao', 'Ovação da Torcida', {
    text: 'Ao entrar em jogo, compre 1 carta. Enquanto estiver em jogo, curas curam 10 a mais.', rarity: 'uncommon',
    subtype: 'EVENT', tags: ['campo', 'evento'],
    onPlay: [FX('drawCards', { amount: 1 })],
    mods: { healFlat: 10 }, scope: 'all'
  }),
  field('jfd-zona-neutra', 'Zona Neutra', {
    text: 'Todos os Agentes recustam com 1 Energia a menos.', rarity: 'rare',
    subtype: 'ARENA', tags: ['campo'],
    override: { retreatCostMod: -1 }, scope: 'all'
  }),

  // ---- Aggro (KOF 12) -----------------------------------------------------
  field('jfd-pressao-kof', 'Arena de Pressão KOF', {
    text: 'Ao entrar em jogo, compre 1 carta. Enquanto estiver em jogo, ataques de TODOS os Agentes causam +10 de dano.', rarity: 'rare',
    faction: 'kof-12', subtype: 'ARENA', tags: ['campo', 'aggro'],
    onPlay: [FX('drawCards', { amount: 1 })],
    mods: { damageDealtFlat: 10 }, scope: 'all'
  }),
  field('jfd-ring-final', 'Ring Final', {
    text: 'Ataques de TODOS os Agentes causam 50% a mais de dano. Partidas viram trocas rápidas.', rarity: 'rare',
    faction: 'kof-12', subtype: 'ARENA', tags: ['campo', 'aggro', 'risco'],
    override: { damageMultAll: 1.5 }, scope: 'all'
  }),

  // ---- Controle (Asgard) --------------------------------------------------
  field('jfd-santuario-asgard', 'Santuário de Asgard', {
    text: 'Enquanto estiver em jogo, curas curam 20 a mais.', rarity: 'uncommon',
    faction: 'asgard', subtype: 'ARENA', tags: ['campo', 'controle'],
    mods: { healFlat: 20 }, scope: 'all'
  }),
  field('jfd-bastiao-asgard', 'Bastião de Asgard', {
    text: 'Todos os Agentes reduzem 10 de dano recebido.', rarity: 'rare',
    faction: 'asgard', subtype: 'ARENA', tags: ['campo', 'controle'],
    mods: { damageTakenFlat: 10 }, scope: 'all'
  }),

  // ---- Midrange (Morning Star) -------------------------------------------
  field('jfd-mercado-ms', 'Mercado Morning Star', {
    text: 'Ao entrar em jogo, compre 1 carta. No início de cada turno seu, compre 1 carta a mais.', rarity: 'rare',
    faction: 'morning-star', subtype: 'ARENA', tags: ['campo', 'midrange', 'economia'],
    onPlay: [FX('drawCards', { amount: 1 })],
    mods: { drawExtra: 1 }, scope: 'owner'
  }),
  field('jfd-logistica-ms', 'Logística Morning Star', {
    text: 'Ao entrar em jogo, recupere 1 carta do descarte para a mão.', rarity: 'uncommon',
    faction: 'morning-star', subtype: 'EVENT', tags: ['campo', 'midrange'],
    onPlay: [FX('retrieveFromDiscard', { amount: 1, pick: 'you', reveal: true })]
  }),

  // ---- Burst (Bastard Gran Tubarões XYZ) ----------------------------------
  field('jfd-mare-vermelha', 'Maré Vermelha', {
    text: 'Ataques de TODOS os Agentes causam +10 de dano. Ao entrar em jogo, cause 10 de dano ao Ativo inimigo.', rarity: 'rare',
    faction: 'bastard-gran-tubaroes-xyz', subtype: 'ARENA', tags: ['campo', 'burst'],
    onPlay: [FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Maré Vermelha' })],
    mods: { damageDealtFlat: 10 }, scope: 'all'
  }),
  field('jfd-zona-de-troca', 'Zona de Troca', {
    text: 'Todos os Agentes recustam com 1 Energia a menos e ataques causam +5 de dano.', rarity: 'uncommon',
    faction: 'bastard-gran-tubaroes-xyz', subtype: 'ARENA', tags: ['campo', 'burst'],
    override: { retreatCostMod: -1 },
    mods: { damageDealtFlat: 5 }, scope: 'all'
  }),

  // ---- Disrupção (Rainbow Six) --------------------------------------------
  field('jfd-zona-silenciosa', 'Zona Silenciosa', {
    text: 'Ao entrar em jogo, descarte 1 Energia do Ativo inimigo.', rarity: 'rare',
    faction: 'rainbow-six', subtype: 'EVENT', tags: ['campo', 'disrupção', 'energy denial'],
    onPlay: [FX('detachResource', { target: 'enemyActive', amount: 1, to: 'discard' })]
  }),
  field('jfd-blackout-geral', 'Blackout Geral', {
    text: 'Enquanto estiver em jogo, habilidades de TODOS os Agentes ficam desativadas.', rarity: 'legendary',
    faction: 'rainbow-six', subtype: 'DOMAIN', tags: ['campo', 'disrupção'],
    override: { disableAbilities: true }, scope: 'all'
  }),

  // ---- Tempo (Platinum) ---------------------------------------------------
  field('jfd-relogio', 'Relógio de Precisão', {
    text: 'Ao entrar em jogo, compre 1 carta. Todos os Agentes recustam com 1 Energia a menos.', rarity: 'uncommon',
    faction: 'platinum', subtype: 'EVENT', tags: ['campo', 'tempo'],
    onPlay: [FX('drawCards', { amount: 1 })],
    override: { retreatCostMod: -1 }, scope: 'all'
  }),
  field('jfd-zona-controlada', 'Zona Controlada', {
    text: 'Enquanto estiver em jogo, você pode conectar 1 Energia extra por turno.', rarity: 'rare',
    faction: 'platinum', subtype: 'ARENA', tags: ['campo', 'tempo'],
    override: { attachExtra: 1 }, scope: 'owner'
  }),

  // ---- Sustain (Weigon) ---------------------------------------------------
  field('jfd-fonte', 'Fonte Vital', {
    text: 'Ao entrar em jogo, cure 30 do seu Ativo. Enquanto estiver em jogo, curas curam 10 a mais.', rarity: 'uncommon',
    faction: 'weigon', subtype: 'EVENT', tags: ['campo', 'sustain'],
    onPlay: [FX('heal', { target: 'activeAlly', amount: 30 })],
    mods: { healFlat: 10 }, scope: 'all'
  }),
  field('jfd-ancoradouro', 'Ancoradouro', {
    text: 'No início do seu turno, cure 10 de todos os seus Agentes.', rarity: 'rare',
    faction: 'weigon', subtype: 'ARENA', tags: ['campo', 'sustain'],
    triggers: [{
      id: 'tr-ancoradouro', name: 'Maré Estável', trigger: 'turnStart', oncePerTurn: true,
      effects: [FX('heal', { target: 'allAllies', amount: 10 })],
      text: 'No início do seu turno: cure 10 de todos os seus Agentes.'
    }], scope: 'owner'
  }),

  // ---- Combo (Salvatore) --------------------------------------------------
  field('jfd-territorio-de-caca', 'Território de Caça', {
    text: 'Ao entrar em jogo, marque o Agente Ativo inimigo por 2 turnos.', rarity: 'uncommon',
    faction: 'salvatore', subtype: 'EVENT', tags: ['campo', 'combo', 'marca'],
    onPlay: [FX('applyStatus', { target: 'enemyActive', status: 'marked', tokens: 2 })]
  }),

  // ---- Genérico -----------------------------------------------------------
  field('jfd-coliseu', 'Coliseu', {
    text: 'Ao entrar em jogo, cause 15 de dano ao Agente Ativo inimigo.', rarity: 'common',
    subtype: 'EVENT', tags: ['campo', 'evento'],
    onPlay: [FX('dealDamage', { target: 'enemyActive', amount: 15, label: 'Coliseu' })]
  })
];
