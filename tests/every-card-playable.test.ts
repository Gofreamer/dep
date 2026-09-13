/**
 * EVERY-CARD PLAYABLE (pack JET + fixture NEXO) — todo o registry em teste.
 *
 * Registra os DOIS packs e executa o harness compartilhado. O gate de
 * produção JET fica em tests/every-card-jet.test.ts (SOMENTE pack JET).
 */
import { registerJetDataPack } from '../src/data/jet/pack';
import { registerDataPack } from '../src/data/fixtures/nexo/cards';
import { registry } from '../src/engine/registry';
import { runEveryCardSuite } from './everyCardHarness';

registerJetDataPack();
registerDataPack();

runEveryCardSuite(registry.allCards());
