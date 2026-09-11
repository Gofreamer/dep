import { expect, test } from '@playwright/test';
import { toMenu } from './helpers';

/**
 * Responsividade: roda nos projetos mobile-touch (390×844, toque) e tablet
 * (768×1024). O critério é objetivo — sem rolagem horizontal, controles
 * principais visíveis e com área de toque usável.
 */

test.describe('layout responsivo', () => {
  test('nenhuma tela transborda horizontalmente', async ({ page }) => {
    for (const path of ['/', '/']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `transbordo horizontal de ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test('título e menu são usáveis no toque', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('title-enter')).toBeVisible();
    await expect(page.getByTestId('title-enter')).toBeEnabled();
    await page.getByTestId('title-enter').tap();
    await expect(page.getByTestId('menu-screen')).toBeVisible();

    await expect(page.locator('.menu-card')).toHaveCount(7);
    for (const testId of ['menu-play', 'menu-multiplayer', 'menu-tutorial', 'menu-builder', 'menu-collection', 'menu-history', 'menu-settings']) {
      const el = page.getByTestId(testId);
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box, `${testId} sem caixa`).not.toBeNull();
      // área de toque mínima confortável (40px de altura)
      expect(box!.height, `${testId} baixo demais para toque`).toBeGreaterThanOrEqual(40);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('seleção de baralho e partida cabem na tela do celular', async ({ page }) => {
    await toMenu(page);
    await page.getByTestId('menu-play').tap();
    await expect(page.getByTestId('deck-select-screen')).toBeVisible();
    await expect(page.getByTestId('deck-start')).toBeVisible();
    await page.getByTestId('deck-start').tap();
    await expect(page.getByTestId('match-screen')).toBeVisible();

    // barra do adversário, minha barra, mão e ação de preparar continuam visíveis
    await expect(page.getByTestId('opp-bar')).toBeVisible();
    await expect(page.getByTestId('my-bar')).toBeVisible();
    await expect(page.getByTestId('hand')).toBeVisible();
    await expect(page.getByTestId('setup-done')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `board com transbordo de ${overflow}px`).toBeLessThanOrEqual(1);
  });
});
