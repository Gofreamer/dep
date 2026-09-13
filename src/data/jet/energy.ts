import { registry } from '../../engine/registry';
import type { ResourceDef } from '../../engine/types';

/**
 * ENERGIA JET — cartas de recurso auxiliares (gameplay-original para o TCG,
 * nomes neutros). Affinities são apenas gameplay/config; nenhum agente é
 * forçado a um elemento que a fonte JET não fornece.
 *
 * Curva de valor: 1 Energia básica é a linha de base; cartas com utilidade
 * (draw, dano, dreno, custo reduzido) pagam por isso com raridade/tempo
 * (temporary) ou desvantagem explícita.
 */
export const JET_ENERGY: ResourceDef[] = [
  {
    id: 'jres-energia', kind: 'RESOURCE', name: 'Energia JET', faction: 'neutro', rarity: 'common',
    tags: ['energia'], art: { motif: 'energia', seed: 'jres-energia' },
    resourceType: '*', amount: 1,
    text: 'Conecte 1 Energia JET a um dos seus Agentes.'
  },
  {
    id: 'jres-nucleo', kind: 'RESOURCE', name: 'Núcleo de Energia', faction: 'neutro', rarity: 'rare',
    tags: ['energia', 'aceleração'], art: { motif: 'energia', seed: 'jres-nucleo' },
    resourceType: '*', amount: 1, wild: true,
    text: 'Energia JET coringa: paga qualquer custo.'
  },
  {
    id: 'jres-bateria', kind: 'RESOURCE', name: 'Bateria de Campo', faction: 'neutro', rarity: 'uncommon',
    tags: ['energia', 'aceleração'], art: { motif: 'energia', seed: 'jres-bateria' },
    resourceType: '*', amount: 1, temporary: true,
    onAttach: [{ op: 'drawCards', amount: 1 }],
    text: 'Temporária (descartada ao pagar custos). Ao conectar, compre 1 carta.'
  },
  {
    id: 'jres-rele', kind: 'RESOURCE', name: 'Relé de Transferência', faction: 'neutro', rarity: 'uncommon',
    tags: ['energia', 'transferência'], art: { motif: 'energia', seed: 'jres-rele' },
    resourceType: '*', amount: 1,
    mods: { retreatCostMod: -1 },
    text: 'O Agente conectado recusta com 1 Energia a menos.'
  },
  {
    id: 'jres-condensador', kind: 'RESOURCE', name: 'Condensador', faction: 'neutro', rarity: 'rare',
    tags: ['energia', 'recuperação'], art: { motif: 'energia', seed: 'jres-condensador' },
    resourceType: '*', amount: 1,
    mods: { damageTakenFlat: 10 },
    text: 'O Agente conectado reduz 10 de dano recebido.'
  },
  {
    id: 'jres-descarga', kind: 'RESOURCE', name: 'Descarga Residual', faction: 'neutro', rarity: 'common',
    tags: ['energia', 'descarte'], art: { motif: 'energia', seed: 'jres-descarga' },
    resourceType: '*', amount: 1, temporary: true,
    onAttach: [{ op: 'dealDamage', target: 'enemyActive', amount: 10, label: 'Descarga Residual' }],
    text: 'Temporária. Ao conectar, cause 10 de dano ao Agente Ativo inimigo.'
  },
  {
    id: 'jres-catalisador', kind: 'RESOURCE', name: 'Catalisador de Combate', faction: 'neutro', rarity: 'rare',
    tags: ['energia', 'agressão'], art: { motif: 'energia', seed: 'jres-catalisador' },
    resourceType: '*', amount: 1,
    mods: { attackCostReduce: 1 },
    text: 'O Agente conectado ataca com 1 Energia a menos (mínimo 1).'
  },
  {
    id: 'jres-overclock', kind: 'RESOURCE', name: 'Overclock', faction: 'neutro', rarity: 'rare',
    tags: ['energia', 'aceleração', 'risco'], art: { motif: 'energia', seed: 'jres-overclock' },
    resourceType: '*', amount: 2, temporary: true,
    onAttach: [{ op: 'dealDamage', target: 'self', amount: 10, label: 'Sobrecarga' }],
    text: 'Temporária. Fornece 2 Energias. Ao conectar, o Agente sofre 10 de dano.'
  },
  {
    id: 'jres-dreno', kind: 'RESOURCE', name: 'Dreno de Energia', faction: 'neutro', rarity: 'uncommon',
    tags: ['energia', 'disrupção'], art: { motif: 'energia', seed: 'jres-dreno' },
    resourceType: '*', amount: 1, temporary: true,
    onAttach: [{ op: 'detachResource', target: 'enemyActive', amount: 1, to: 'discard' }],
    text: 'Temporária. Ao conectar, descarte 1 Energia do Agente Ativo inimigo.'
  },
  {
    id: 'jres-estabilizador', kind: 'RESOURCE', name: 'Estabilizador Vital', faction: 'neutro', rarity: 'common',
    tags: ['energia', 'sustentação'], art: { motif: 'energia', seed: 'jres-estabilizador' },
    resourceType: '*', amount: 1,
    mods: { healFlat: 10 },
    text: 'Curas recebidas pelo Agente conectado curam 10 a mais.'
  }
];

export function registerJetEnergy(): void {
  // tipo de recurso genérico exibido como "Energia JET"
  if (!registry.resourceType('*')) {
    registry.registerResourceType({ id: '*', name: 'Energia JET', color: '#d4af37', wild: true });
  }
}
