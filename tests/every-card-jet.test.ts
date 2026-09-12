/**
 * EVERY-CARD JET — cobertura específica do JET PRODUCTION PACK (Fase 35).
 *
 * Registra SOMENTE o pack JET (nenhuma fixture NEXO) e executa o harness
 * compartilhado sobre TODAS as CardDefs JET reais. Este é o gate que NÃO pode
 * ser satisfeito contando NEXO/fixtures.
 */
import { describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { registry } from '../src/engine/registry';
import { jetPackCounts, registryReport } from '../src/data/jet/metrics';
import { runEveryCardSuite } from './everyCardHarness';

registerJetDataPack();

const JET_CARDS = registry.allCards();
const REPORT = registryReport();

describe('JET production pack — métricas (Fase 1)', () => {
  it('registra o Core Set expandido (alvo ~140–170 CardDefs JET reais)', () => {
    expect(REPORT.jetTotal).toBeGreaterThanOrEqual(140);
    expect(REPORT.jetTotal).toBeLessThanOrEqual(180);
  });

  it('NÃO conta fixtures NEXO como conteúdo JET', () => {
    expect(REPORT.jetTotal).toBe(JET_CARDS.length);
    // fixture separado (NEXO não é registrado aqui)
    expect(registry.allCards().filter((d) => d.id.startsWith('char-') || d.id.startsWith('res-') || d.id.startsWith('act-') || d.id.startsWith('fd-') || d.id.startsWith('eq-'))).toHaveLength(0);
  });

  it('distribuição por categoria respeita as faixas alvo', () => {
    const c = jetPackCounts();
    expect(c.agents + c.editions).toBeGreaterThanOrEqual(28);
    expect(c.energy).toBeGreaterThanOrEqual(8);
    expect(c.energy).toBeLessThanOrEqual(12);
    expect(c.techniques).toBeGreaterThanOrEqual(40);
    expect(c.techniques).toBeLessThanOrEqual(55);
    expect(c.equipment).toBeGreaterThanOrEqual(20);
    expect(c.equipment).toBeLessThanOrEqual(30);
    expect(c.fields).toBeGreaterThanOrEqual(15);
    expect(c.fields).toBeLessThanOrEqual(22);
    expect(c.team).toBeGreaterThanOrEqual(20);
    expect(c.team).toBeLessThanOrEqual(30);
  });

  it('todas as Cartas JET reais passam pelo harness (função + jogável + integridade)', () => {
    expect(JET_CARDS.length).toBe(REPORT.jetTotal);
  });
});

// Execução real de TODA carta JET (mesmo harness do every-card completo).
runEveryCardSuite(JET_CARDS, {
  gameplay: 'JET — toda carta tem função real de gameplay',
  playable: 'JET — toda carta é jogável de verdade (execução real)',
  integrity: 'JET — integridade estrutural das CardDefs'
});
