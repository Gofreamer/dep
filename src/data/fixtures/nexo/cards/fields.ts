import type { CardDef, FieldDef } from '../../../../engine/types';

const FD = (id: string, name: string, rarity: FieldDef['rarity'], o: { text?: string; mods?: FieldDef['mods']; override?: FieldDef['override']; scope?: FieldDef['scope']; onPlay?: FieldDef['onPlay'] } = {}): FieldDef => ({
  id,
  kind: 'FIELD',
  name,
  text: o.text,
  faction: 'neutro',
  rarity,
  tags: ['campo'],
  art: { motif: 'field', seed: id },
  mods: o.mods,
  override: o.override,
  scope: o.scope ?? 'owner',
  onPlay: o.onPlay
});

/**
 * Campos — efeitos globais persistentes. Apenas 1 por vez (configurável).
 * Os hooks de `override` sustentam estados temporários de alto impacto.
 */
export const FIELDS: FieldDef[] = [
  FD('fd-arena-solar', 'Arena Solar', 'common', {
    scope: 'owner', mods: { damageDealtFlat: 10 },
    text: 'Seus personagens causam +10 de dano.'
  }),
  FD('fd-forja', 'Forja de Campo', 'rare', {
    scope: 'owner', mods: { attachExtra: 1 },
    text: 'Você pode conectar 1 recurso adicional por turno.'
  }),
  FD('fd-mare-alta', 'Maré Alta', 'uncommon', {
    scope: 'owner', mods: { healFlat: 10 },
    text: 'Curas em seus personagens são 10 mais fortes.'
  }),
  FD('fd-nevoeiro', 'Névoa Densa', 'uncommon', {
    scope: 'all', override: { retreatCostMod: 1 },
    text: 'Todos os recuos custam 1 recurso a mais.'
  }),
  FD('fd-zona-bloqueio', 'Zona de Bloqueio', 'rare', {
    scope: 'all', override: { blockSwitching: true, durationTurns: 2 },
    text: 'Trocas estão bloqueadas por 2 turnos.'
  }),
  FD('fd-nexo-central', 'Nexo Central', 'legendary', {
    scope: 'all', mods: { drawExtra: 1 },
    text: 'Ambos os jogadores compram 1 carta adicional por turno.'
  })
];

export const FIELD_CARDS: CardDef[] = FIELDS;
