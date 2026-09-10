import type { CardDef, ResourceDef } from '../../engine/types';

const R = (id: string, name: string, resourceType: string, rarity: ResourceDef['rarity'], o: Partial<ResourceDef> = {}, text?: string): ResourceDef => ({
  id,
  kind: 'RESOURCE',
  name,
  text,
  faction: o.resourceType && o.resourceType !== '*' ? o.resourceType : 'neutro',
  affinity: o.resourceType === '*' ? 'neutro' : o.resourceType,
  rarity,
  tags: ['recurso'],
  art: { motif: 'resource', seed: id },
  resourceType,
  amount: 1,
  wild: o.wild,
  onAttach: o.onAttach,
  mods: o.mods,
  unique: o.unique
});

/**
 * Recursos: os 5 tipos + curingas e recursos especiais.
 * `resourceType: '*'` paga custos genéricos; `wild: true` paga qualquer custo.
 */
export const RESOURCES: ResourceDef[] = [
  R('res-solar', 'Essência Solar', 'solar', 'common', {}, 'Fornece 1 recurso Solar.'),
  R('res-mare', 'Essência Maré', 'mare', 'common', {}, 'Fornece 1 recurso Maré.'),
  R('res-flora', 'Essência Flora', 'flora', 'common', {}, 'Fornece 1 recurso Flora.'),
  R('res-volt', 'Essência Volt', 'volt', 'common', {}, 'Fornece 1 recurso Volt.'),
  R('res-umbra', 'Essência Umbra', 'umbra', 'common', {}, 'Fornece 1 recurso Umbra.'),
  R('res-neutro', 'Núcleo Neutro', '*', 'common', {}, 'Fornece 1 recurso de qualquer tipo.'),
  R('res-prisma', 'Prisma', '*', 'rare', { wild: true }, 'Curinga: conta como 1 recurso de qualquer tipo, inclusive tipado.'),
  R('res-dinamo', 'Dínamo Portátil', '*', 'uncommon', { temporary: true }, 'Recurso temporário: é descartado ao pagar um ataque.'),
  R('res-essencia-viva', 'Essência Viva', 'flora', 'uncommon', { onAttach: [{ op: 'heal', target: 'self', amount: 20 }] }, 'Ao conectar: cura 20 deste personagem.'),
  R('res-nucleo-eco', 'Núcleo Eco', '*', 'uncommon', { onAttach: [{ op: 'drawCards', amount: 1 }] }, 'Ao conectar: compre 1 carta.'),
  R('res-cristal-furia', 'Cristal de Fúria', 'solar', 'rare', { mods: { damageDealtFlat: 10 } }, 'Enquanto conectado: ataques causam +10 de dano.'),
  R('res-ambar', 'Âmbar Estabilizador', '*', 'uncommon', { onAttach: [{ op: 'removeStatus', target: 'self', status: 'all' }] }, 'Ao conectar: remove todos os status deste personagem.')
];

export const RESOURCE_CARDS: CardDef[] = RESOURCES;
