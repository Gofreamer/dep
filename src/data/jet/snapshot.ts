import type { JetSnapshot } from '../../integrations/jet/types';

/**
 * NORMALIZED SNAPSHOT — JET CORE SET (Alpha)
 *
 * ⚠ PENDING CAPTURE: the reference repository (`RocksXB/jet-tactics`) is not
 * publicly accessible from this environment (404 — private or moved). This
 * snapshot must be filled ONLY from the real source files:
 *
 *   docs/CARD_SOURCE_OF_TRUTH.md      → identidade oficial
 *   js/services/jet-cards.js          → catálogo Jet Cards
 *   js/game/agents.js                 → agentes
 *   js/game/curated-agents-1..6.js    → kits curados
 *   js/game/editions.js               → edições oficiais
 *   js/game/power.js                  → referência competitiva (não copiar números)
 *   docs/CURATED_ROSTER_v0.1.md       → roster curado
 *
 * Use `scripts/import-jet-tactics.ts` (or paste the raw records into
 * `raw/` and run it) to regenerate this file. DO NOT hand-invent agents,
 * teams or editions here — see Parte 36 of the product spec (não inventar).
 */
export const JET_SNAPSHOT: JetSnapshot = {
  version: 0,
  setName: 'JET CORE SET — Alpha',
  capturedAt: 'PENDING-CAPTURE',
  teams: [],
  editions: [],
  agents: [],
  kits: []
};

/**
 * Roster apontado pela diretriz do produto como "atualmente curado" — registro
 * de TRABALHO (proveniência task-prompt-fallback) para conferência 1:1 contra
 * a fonte. Nenhum destes nomes entra no jogo sem o registro correspondente no
 * snapshot oficial acima.
 */
export const ROSTER_TO_CONFIRM: string[] = [
  'Hashika Gloves', 'Henry', 'Kaio', 'Baek Seo-jin', 'Jenny', 'Olivia Mih',
  'Wei Fang', 'Ruby', 'Xixim', 'Alice Westland', 'Tarruh', 'Tayná Lannister Müller',
  'Ran Yuki', 'Shirakami Niku', 'Wei Wang', 'Mik Kashnov', 'Ryan Smith', 'Saki'
];
