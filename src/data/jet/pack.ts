import { registry } from '../../engine/registry';
import { JET_SNAPSHOT } from './snapshot';
import { AGENT_TCG_PROFILES } from './agentProfiles';
import { JET_ENERGY, registerJetEnergy } from './energy';
import { JET_TECHNIQUES, JET_EQUIPMENT, JET_FIELDS } from './auxiliares';
import { importSnapshot, pendingCatalog, type ImportReport } from '../../integrations/jet/importer';
import { registerStatuses } from '../statuses';

let registered = false;
let lastReport: ImportReport | null = null;

/**
 * JET CORE SET — the DEFAULT data pack.
 *
 * Registers, in order: statuses (engine-generic), neutral cosmetics, the
 * auxiliary cards (Energia JET, Técnicas, Equipamentos, Campos) and every
 * agent card produced by the Jet Tactics importer from curated profiles.
 */
export function registerJetDataPack(): ImportReport {
  if (registered && lastReport) return lastReport;
  registered = true;
  registerStatuses();
  registerJetEnergy();

  // neutral cosmetics (the JET identity lives in teams/factions from the source)
  if (!registry.faction('neutro')) {
    registry.registerFaction({ id: 'neutro', name: 'Neutro', color: '#9aa3b2' });
  }

  // auxiliary cards
  let number = 1;
  for (const def of [...JET_ENERGY, ...JET_TECHNIQUES, ...JET_EQUIPMENT, ...JET_FIELDS]) {
    if (!registry.tryCard(def.id)) {
      def.number = number++;
      registry.registerCard(def);
    }
  }

  // agents from the official source (empty until capture — see snapshot.ts)
  lastReport = importSnapshot(JET_SNAPSHOT, { profiles: AGENT_TCG_PROFILES });
  return lastReport;
}

/** Catalog entries waiting for a curated TCG profile ("aguardando adaptação"). */
export function jetPendingCatalog(): { agentId: string; name: string; edition: string; note: string }[] {
  return pendingCatalog(JET_SNAPSHOT, AGENT_TCG_PROFILES);
}

export function jetImportReport(): ImportReport | null {
  return lastReport;
}
