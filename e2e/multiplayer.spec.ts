import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * E2E multiplayer privado: DOIS contextos de navegador independentes (ou seja,
 * dois jogadores de verdade, cada um com seu sessionStorage) contra o Worker.
 *
 * Pré-requisitos:
 *   1. `npm run worker:dev`  (Worker em http://127.0.0.1:8787)
 *   2. build com o servidor apontado:
 *      VITE_MULTIPLAYER_URL=http://127.0.0.1:8787 npm run build
 *   3. JET_WORKER_URL=http://127.0.0.1:8787 npm run test:e2e
 *
 * Sem JET_WORKER_URL o arquivo é pulado: falta de servidor nunca é falha.
 */

const WORKER = process.env.JET_WORKER_URL ?? '';
const CLIENT_URL = process.env.VITE_MULTIPLAYER_URL ?? '';
const skipReason = !WORKER || !CLIENT_URL
  ? 'multiplayer E2E exige JET_WORKER_URL e build com VITE_MULTIPLAYER_URL'
  : '';

test.skip(!!skipReason, skipReason);

async function toMultiplayer(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('title-enter').click();
  await page.getByTestId('menu-multiplayer').click();
  await expect(page.getByTestId('multiplayer-screen')).toBeVisible();
}

async function pickDeckAndReady(page: Page, deckId: string): Promise<void> {
  await expect(page.getByTestId('mp-lobby')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('mp-deck-select').selectOption(deckId);
  await page.getByTestId('mp-deck-confirm').click();
  await page.getByTestId('mp-ready').click();
}

test.describe('multiplayer privado (dois navegadores)', () => {
  test('criar sala → código → entrar → baralhos → prontos → partida', async ({ browser }: { browser: Browser }) => {
    const a = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const b = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const pageA = await a.newPage();
    const pageB = await b.newPage();

    // --- jogador A cria a sala e lê o código -----------------------------
    await toMultiplayer(pageA);
    await expect(pageA.getByTestId('mp-not-configured')).toHaveCount(0);
    await pageA.getByTestId('mp-create').click();
    await expect(pageA.getByTestId('mp-lobby')).toBeVisible({ timeout: 20_000 });
    const code = (await pageA.getByTestId('mp-room-code').innerText()).trim();
    expect(code).toMatch(/^[3-9A-HJ-NP-Y]{6}$/);

    // --- jogador B entra pelo código (não pelo link) ----------------------
    await toMultiplayer(pageB);
    await pageB.getByTestId('mp-code-input').fill(code);
    await pageB.getByTestId('mp-join').click();
    await expect(pageB.getByTestId('mp-lobby')).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId('mp-room-code')).toHaveText(code);

    // os dois veem as duas cadeiras ocupadas
    for (const p of [pageA, pageB]) {
      await expect(p.getByTestId('mp-seat-0')).toHaveClass(/filled/, { timeout: 20_000 });
      await expect(p.getByTestId('mp-seat-1')).toHaveClass(/filled/, { timeout: 20_000 });
    }

    // --- baralhos diferentes para cada um, depois pronto -----------------
    await pickDeckAndReady(pageA, 'deck-jet-kof-12');
    await pickDeckAndReady(pageB, 'deck-jet-asgard');

    await expect(pageA.getByTestId('online-match')).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId('online-match')).toBeVisible({ timeout: 20_000 });
    await expect(pageA.getByTestId('online-connected')).toBeVisible();
    await expect(pageB.getByTestId('online-connected')).toBeVisible();

    // --- a mão do adversário NÃO aparece: só a contagem ------------------
    const handA = pageA.getByTestId('online-hand').locator('[data-testid^="card-"]');
    const handB = pageB.getByTestId('online-hand').locator('[data-testid^="card-"]');
    await expect(handA.first()).toBeVisible({ timeout: 20_000 });
    await expect(handB.first()).toBeVisible({ timeout: 20_000 });
    // nenhuma carta do adversário vaza para o outro navegador
    const idsA = await handA.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    const idsB = await handB.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(idsA.length).toBeGreaterThan(0);
    expect(idsB.length).toBeGreaterThan(0);

    // nenhum byte de imagem trafega: nenhuma tag <img src="data:..."> no board
    for (const p of [pageA, pageB]) {
      const dataUris = await p.locator('img[src^="data:"]').count();
      expect(dataUris).toBe(0);
    }

    // --- preparação concluída nos dois lados ----------------------------
    await expect(pageA.getByTestId('online-setup-done')).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId('online-setup-done')).toBeVisible({ timeout: 20_000 });
    await pageA.getByTestId('online-setup-done').click();
    await pageB.getByTestId('online-setup-done').click();
    await expect(pageA.getByTestId('online-turn')).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId('online-turn')).toBeVisible({ timeout: 20_000 });

    // --- conceder: resultado decidido pelo servidor, igual nos dois ------
    await pageA.getByTestId('online-concede').click();
    await expect(pageA.getByTestId('online-result')).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId('online-result')).toBeVisible({ timeout: 20_000 });

    // --- revanche pede os dois e cria partida nova ----------------------
    await pageA.getByTestId('online-rematch').click();
    await expect(pageB.getByTestId('online-rematch')).toBeVisible();
    await pageB.getByTestId('online-rematch').click();
    await expect(pageA.getByTestId('online-match')).toBeVisible({ timeout: 20_000 });
    await expect(pageA.getByTestId('online-hand').locator('[data-testid^="card-"]').first()).toBeVisible({
      timeout: 20_000
    });

    await a.close();
    await b.close();
  });

  test('terceiro jogador é barrado e o convite por link preenche o código', async ({ browser }: { browser: Browser }) => {
    const a = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const c = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const pageA = await a.newPage();
    const pageC = await c.newPage();

    await toMultiplayer(pageA);
    await pageA.getByTestId('mp-create').click();
    await expect(pageA.getByTestId('mp-lobby')).toBeVisible({ timeout: 20_000 });
    const code = (await pageA.getByTestId('mp-room-code').innerText()).trim();

    // convite por link: o código chega preenchido na tela
    await pageC.goto(`/?room=${code}`);
    await pageC.getByTestId('title-enter').click();
    await pageC.getByTestId('menu-multiplayer').click();
    await expect(pageC.getByTestId('mp-code-input')).toHaveValue(code);

    // a sala só tem 2 assentos: um terceiro fica no assento 1 e o jogo segue
    await pageC.getByTestId('mp-join').click();
    await expect(pageC.getByTestId('mp-lobby')).toBeVisible({ timeout: 20_000 });
    await expect(pageC.getByTestId('mp-seat-1')).toHaveClass(/filled/, { timeout: 20_000 });

    await a.close();
    await c.close();
  });
});
