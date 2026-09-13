import { expect, test, type Page } from '@playwright/test';
import { finishSetup, toMenu } from './helpers';

/**
 * E2E da Liga Ranqueada — fluxo REAL contra o Worker (D1 + auth + replay).
 *
 * Pré-requisitos (como o multiplayer):
 *   1. Worker local com D1 (`npm run worker:dev`) em http://127.0.0.1:8787;
 *   2. build apontado: VITE_RANKED_API_URL=http://127.0.0.1:8787 npm run build;
 *   3. JET_WORKER_URL=http://127.0.0.1:8787 + VITE_RANKED_API_URL no teste.
 *
 * Sem essas variáveis o arquivo é PULADO (falta de servidor nunca é falha).
 */
const WORKER = process.env.JET_WORKER_URL ?? '';
const API = process.env.VITE_RANKED_API_URL ?? '';
const skipReason = !WORKER || !API ? 'ranked E2E exige JET_WORKER_URL e build com VITE_RANKED_API_URL' : '';

test.skip(!!skipReason, skipReason);

async function register(page: Page, username: string): Promise<void> {
  await toMenu(page);
  await page.getByTestId('menu-ranked').click();
  await expect(page.getByTestId('ranked-screen')).toBeVisible();
  // sem token → tela de login; alterna para registro
  if (await page.getByTestId('ranked-submit').count()) {
    await page.getByText('Não tem conta? Criar').click();
  }
  await page.getByTestId('ranked-username').fill(username);
  await page.getByTestId('ranked-password').fill('senha-forte-123');
  await page.getByTestId('ranked-submit').click();
  await expect(page.getByTestId('ranked-play')).toBeVisible({ timeout: 20_000 });
}

test.describe('Liga Ranqueada (Worker + D1)', () => {
  test('registro → ladder (StellaPrime #1, Top 10 = Rei da Liga) → perfil', async ({ page }) => {
    const username = `e2e_${Date.now() % 1000000}`;
    await register(page, username);

    // ladder público com StellaPrime no topo e título REI DA LIGA no Top 10
    await expect(page.getByTestId('ranked-ladder')).toBeVisible();
    await expect(page.locator('.ladder-table tbody tr').first()).toContainText('StellaPrime');
    await expect(page.locator('.ladder-table tbody tr').first()).toContainText('REI DA LIGA');
    await expect(page.locator('.ladder-table tbody tr').nth(0).getAttribute('class')).toContain('top10');
    // Top 10 inteiro = Rei da Liga (todos CAMPEÃO)
    await expect(page.locator('.ladder-table tbody tr.top10')).toHaveCount(10);

    // perfil próprio: rating inicial 1000 → Ferro
    await expect(page.locator('.ranked-me')).toContainText('Ferro');
    await expect(page.locator('.ranked-me')).toContainText('1000');
  });

  test('partida ranqueada chega ao board e volta ao ranking com resultado', async ({ page }) => {
    const username = `e2e_${Date.now() % 1000000}`;
    await register(page, username);

    await page.getByTestId('ranked-play').click();
    await expect(page.getByTestId('match-screen')).toBeVisible({ timeout: 20_000 });

    // preparação e primeiro turno
    await finishSetup(page);

    // Joga até acabar (o bot decide; o humano só passa o turno) — limitado.
    const endTurn = page.getByTestId('end-turn');
    for (let i = 0; i < 160; i++) {
      // escolha pendente (ex.: efeitos de compra/descarte) — resolve a primeira
      const chip = page.locator('.choice-chip').first();
      if (await chip.count()) {
        await chip.click();
        const confirm = page.locator('.choice-actions .btn').first();
        if (await confirm.count()) await confirm.click();
        await page.waitForTimeout(400);
        continue;
      }
      if (await endTurn.isVisible()) {
        await endTurn.click();
        await page.waitForTimeout(600);
        continue;
      }
      if (await page.getByTestId('ranked-result').count()) break;
      if (await page.getByTestId('ranked-screen').count()) break;
      await page.waitForTimeout(600);
    }

    // o servidor validou e aplicou o rating — de volta ao ranking com resultado
    await expect(page.getByTestId('ranked-screen')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ranked-result')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ranked-result')).toContainText(/Vitória|Derrota/);
  });
});
