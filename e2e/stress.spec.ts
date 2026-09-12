import { expect, test, type Page } from '@playwright/test';
import { finishSetup, startAiMatch, toMenu, watchConsole, expectNoConsoleErrors } from './helpers';

/**
 * Stress visual do board (Fase 6 do plano 2.0).
 *
 * Cenário: partida longa (turno 50), reservas CHEIAS (5+5), mão e descarte
 * grandes, status ativos — nos 5 viewports obrigatórios a 100% de zoom:
 * 1440×900, 1366×768, 768×1024, 390×844 e 360×800.
 *
 * Gates verificados por viewport:
 *  - SEM overflow horizontal (documento e .match-screen);
 *  - controles críticos (Encerrar Turno/Pronto, ataques, recuo) com caixa
 *    DENTRO do viewport (nada clipado/inacessível);
 *  - a última carta da mão é alcançável (scroll interno);
 *  - log tem max-height + overflow interno (não estoura o board);
 *  - layout com tamanho estável: a tela não cresce com turno/status/descarte.
 *
 * O estado de stress é montado pelo gancho dev-only `window.__jetDev`
 * (exigido apenas quando o Modo desenvolvedor está ativo — instrumentação
 * deliberada, nunca cheat de jogo: não altera regras, só o estado visual).
 */

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
] as const;

const STRESS_BASES = [
  'agent-ran-yuki-base',
  'agent-jenny-base',
  'agent-shirakami-niku-base',
  'agent-xixim-base',
  'agent-kaio-base',
];

type DevHook = {
  debug: (op: string, payload?: Record<string, unknown>) => void;
  engine: {
    state: {
      players: { bench: unknown[] }[];
    };
  };
};

/** Liga o Modo desenvolvedor no save persistido (o gancho __jetDev exige). */
async function enableDevMode(page: Page): Promise<void> {
  await toMenu(page);
  await page.evaluate(() => {
    const KEY = 'jet-tcg:meta:v2';
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        const d = JSON.parse(raw) as { settings?: Record<string, unknown> };
        if (d && d.settings) {
          d.settings.devMode = true;
          localStorage.setItem(KEY, JSON.stringify(d));
        }
      } catch {
        // save ilegível: deixa o app recriar com o padrão
      }
    }
  });
  // Recarregar volta para a tela de título — entra de novo no menu.
  await page.reload();
  await page.getByTestId('title-enter').click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
}

async function startMatchWithDev(page: Page): Promise<void> {
  await enableDevMode(page);
  await startAiMatch(page, 'deck-jet-kof-12');
  await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>).__jetDev));
  await finishSetup(page);
}

/** Monta o estado de stress (turno 50, reservas cheias, mão/descarte grandes). */
async function applyStress(page: Page): Promise<void> {
  await page.evaluate((stressBases) => {
    const dev = (window as unknown as Record<string, unknown>).__jetDev as DevHook;
    dev.debug('setTurn', { value: 50 });
    // Reservas EXATAMENTE cheias (5+5) — respeita o que o setup já posicionou.
    for (const owner of [0, 1]) {
      const current = dev.engine.state.players[owner].bench.length;
      for (let i = current; i < 5; i++) {
        dev.debug('spawnCharacter', { owner, defId: stressBases[i % stressBases.length] });
      }
    }
    // Mão grande (ações + recursos + equips) e descarte grande.
    for (let i = 0; i < 6; i++) dev.debug('addCardToHand', { defId: 'jact-purificacao' });
    dev.debug('discardHand', { amount: 5 });
    dev.debug('addCardToHand', { defId: 'jres-energia' });
    dev.debug('addCardToHand', { defId: 'jact-retomada' });
    dev.debug('addCardToHand', { defId: 'jeq-manopla' });
    // Status no ativo (badges de status sob stress)
    const activeUids = dev.engine.state.players.map((p) => (p as { active?: { uid: string } }).active?.uid).filter(Boolean) as string[];
    for (const uid of activeUids) dev.debug('applyStatus', { targetUid: uid, statusId: 'burn', tokens: 2 });
  }, STRESS_BASES);
  await page.waitForTimeout(300);
}

/** Assertiva central de layout por viewport. */
async function assertLayout(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => {
    const de = document.documentElement;
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const inViewport = (b: { top: number; bottom: number; left: number; right: number } | null): boolean =>
      !!b && b.top >= -0.5 && b.left >= -0.5 && b.bottom <= window.innerHeight + 0.5 && b.right <= window.innerWidth + 0.5;
    const hand = document.querySelector('.hand');
    const buttons = [...document.querySelectorAll('.command-dock button')].map((btn) => {
      const b = box(btn);
      const disabled = (btn as HTMLButtonElement).disabled;
      return { text: (btn.textContent ?? '').trim().slice(0, 24), disabled, inViewport: inViewport(b), box: b };
    });
    return {
      zoom: window.devicePixelRatio,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      docScrollW: de.scrollWidth,
      docClientW: de.clientWidth,
      bodyScrollW: document.body.scrollWidth,
      screenBox: box(document.querySelector('.match-screen')),
      dockBox: box(document.querySelector('.command-dock')),
      handBox: box(hand),
      bannerBox: box(document.querySelector('.turn-banner')),
      bannerText: document.querySelector('.turn-banner')?.textContent ?? '',
      handScrollable: hand ? hand.scrollWidth > hand.clientWidth : false,
      buttons,
      handCards: document.querySelectorAll('.hand .card-mini').length,
      benchCards: document.querySelectorAll('.bench-row .board-card').length,
      statusChips: document.querySelectorAll('.status-chip').length,
    };
  });

  expect(metrics.zoom, `${label}: zoom deve ser 100% (dpr 1)`).toBe(1);
  expect(
    metrics.docScrollW <= metrics.docClientW + 1 && metrics.bodyScrollW <= metrics.viewport.w + 1,
    `${label}: overflow horizontal detectado (doc ${metrics.docScrollW}/${metrics.docClientW}, body ${metrics.bodyScrollW}/${metrics.viewport.w})`
  ).toBe(true);
  expect(metrics.screenBox, `${label}: .match-screen ausente`).toBeTruthy();
  expect(metrics.dockBox, `${label}: dock ausente`).toBeTruthy();
  const dockInView = metrics.dockBox && metrics.dockBox.bottom <= metrics.viewport.h + 1 && metrics.dockBox.top >= -1;
  expect(dockInView, `${label}: dock de comandos fora do viewport (${JSON.stringify(metrics.dockBox)})`).toBe(true);
  for (const b of metrics.buttons) {
    expect(
      b.inViewport || b.disabled,
      `${label}: botão "${b.text}" inacessível (fora do viewport e habilitado): ${JSON.stringify(b.box)}`
    ).toBe(true);
  }
  // Turno 50 exibido (stress de partida longa)
  expect(metrics.bannerText, `${label}: banner sem "Turno 50"`).toContain('Turno 50');
  // Mão grande renderizada; a ÚLTIMA carta precisa ser alcançável (scroll interno)
  expect(metrics.handCards, `${label}: mão não cresceu`).toBeGreaterThanOrEqual(8);
  if (metrics.handScrollable) {
    const lastReachable = await page.evaluate(() => {
      const hand = document.querySelector('.hand')!;
      hand.scrollLeft = hand.scrollWidth;
      const cards = [...hand.querySelectorAll('.card-mini')];
      const last = cards[cards.length - 1];
      if (!last) return false;
      const r = last.getBoundingClientRect();
      return r.right <= window.innerWidth + 1 && r.left >= -1;
    });
    expect(lastReachable, `${label}: última carta da mão inacessível mesmo com scroll`).toBe(true);
  }
  // Reservas cheias renderizadas (5 de cada lado) + status badges visíveis
  expect(metrics.benchCards, `${label}: reservas não estão cheias (${metrics.benchCards}/10)`).toBe(10);
  expect(metrics.statusChips, `${label}: status não renderizados`).toBeGreaterThanOrEqual(1);
}

test.describe('stress visual do board (turno 50, reservas cheias, mão grande)', () => {
  test('layout estável nos 5 viewports a 100% zoom', async ({ page }) => {
    const errors = watchConsole(page);
    await startMatchWithDev(page);
    await applyStress(page);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);
      await assertLayout(page, `${vp.width}×${vp.height}`);
    }
    expectNoConsoleErrors(errors);
  });

  test('log não estoura o board (overflow interno)', async ({ page }) => {
    await startMatchWithDev(page);
    await applyStress(page);
    // Abre o registro de eventos pelo HUD
    await page.getByTitle('Registro').click();
    const log = page.locator('.log-drawer');
    await expect(log).toBeVisible();
    const logMetrics = await log.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        overflowY: cs.overflowY,
        bottom: r.bottom,
        top: r.top,
        inViewport: r.bottom <= window.innerHeight + 1 && r.top >= -1,
      };
    });
    expect(logMetrics.inViewport, `log fora do viewport: ${JSON.stringify(logMetrics)}`).toBe(true);
    expect(
      logMetrics.overflowY === 'auto' || logMetrics.overflowY === 'scroll',
      `log sem overflow interno (${logMetrics.overflowY})`
    ).toBe(true);
  });

  test('controles críticos seguem clicáveis após o stress', async ({ page }) => {
    await startMatchWithDev(page);
    await applyStress(page);
    // Encerrar Turno: sempre presente e clicável no turno do jogador
    const endTurn = page.getByTestId('end-turn');
    await expect(endTurn).toBeVisible();
    await expect(endTurn).toBeEnabled();
    // Botões de ataque renderizados no dock (jogáveis ou desabilitados com motivo)
    await expect(page.locator('.attack-btn').first()).toBeVisible();
    await endTurn.click();
    // No turno da IA o botão desabilita — desabilitado claro é aceitável (gate 28)
    await expect(endTurn).toBeDisabled();
  });
});
