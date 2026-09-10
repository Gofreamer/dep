import { registry } from '../../engine/registry';
import type { CardDef } from '../../engine/types';
import { CHARACTERS } from './characters';
import { RESOURCES } from './resources';
import { ACTIONS } from './actions';
import { EQUIPMENT } from './equipment';
import { FIELDS } from './fields';
import { registerStatuses } from '../statuses';
import { registerCosmetics } from '../factions';

export const ALL_CARDS: CardDef[] = [...CHARACTERS, ...RESOURCES, ...ACTIONS, ...EQUIPMENT, ...FIELDS];

let registered = false;

/** Idempotent registration of the full data pack. */
export function registerDataPack(): void {
  if (registered) return;
  registered = true;
  registerCosmetics();
  registerStatuses();
  ALL_CARDS.forEach((def, i) => {
    def.number = i + 1;
    registry.registerCard(def);
  });
}
