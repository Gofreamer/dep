import { registry } from '../../engine/registry';
import type { ResourceDef } from '../../engine/types';

/**
 * ENERGIA JET — auxiliary resource cards (gameplay-original for the TCG,
 * neutral naming — Parte 17). Affinities are gameplay/config only; no agent
 * is forced into an arbitrary element the JET source does not provide.
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
    mods: { attachExtra: 0, retreatCostMod: -1 },
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
  }
];

export function registerJetEnergy(): void {
  // tipo de recurso genérico exibido como "Energia JET"
  if (!registry.resourceType('*')) {
    registry.registerResourceType({ id: '*', name: 'Energia JET', color: '#d4af37', wild: true });
  }
}
