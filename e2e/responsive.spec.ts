import { expect, test } from '@playwright/test';
import { chooseActiveAgent, toMenu } from './helpers';

/**
 * Responsividade: roda nos projetos mobile-touch (390×844, toque) e tablet
 * (768×1024). O critério é objetivo — sem rolagem horizontal, controles
 * principais visíveis e com área de toque usável.
 */

async function overflow(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
}

test.describe('layout responsivo', () => {
  test('nenhuma tela transborda horizontalmente', async ({ page }) => {
    const telas: { nome: string; abrir: () => Promise<void> }[] = [
      { nome: 'título', abrir: async () => { await page.goto('/'); } },
      {
        nome: 'menu',
        abrir: async () => {
          await page.goto('/');
          await page.getByTestId('title-enter').click();
          await expect(page.getByTestId('menu-screen')).toBeVisible();
        }
      },
      {
        nome: 'seleção de baralho',
        abrir: async () => {
          await toMenu(page);
          await page.getByTestId('menu-play').click();
          await expect(page.getByTestId('deck-select-screen')).toBeVisible();
        }
      },
      {
        nome: 'coleção',
        abrir: async () => {
          await toMenu(page);
          await page.getByTestId('menu-collection').click();
          await expect(page.getByTestId('collection-screen')).toBeVisible();
        }
      }
    ];

    const problemas: string[] = [];
    for (const t of telas) {
      await t.abrir();
      const o = await overflow(page);
      if (o > 1) problemas.push(`${t.nome}: +${o}px`);
    }
    expect(problemas, `transbordo horizontal em ${problemas.length} tela(s)`).toEqual([]);
  });

  test('título e menu são usáveis no toque', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('title-enter')).toBeVisible();
    await expect(page.getByTestId('title-enter')).toBeEnabled();
    await page.getByTestId('title-enter').tap();
    await expect(page.getByTestId('menu-screen')).toBeVisible();

    await expect(page.locator('.menu-card')).toHaveCount(8);
    const baixos: string[] = [];
    for (const testId of ['menu-play', 'menu-ranked', 'menu-multiplayer', 'menu-tutorial', 'menu-builder', 'menu-collection', 'menu-history', 'menu-settings']) {
      const el = page.getByTestId(testId);
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box, `${testId} sem caixa`).not.toBeNull();
      // área de toque mínima confortável (40px de altura)
      if (box!.height < 40) baixos.push(`${testId}: ${Math.round(box!.height)}px`);
    }
    expect(baixos, `alvos de toque baixos demais`).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
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
    // "Pronto" só existe depois de escolher o Agente Base
    await chooseActiveAgent(page);
    await expect(page.getByTestId('setup-done')).toBeVisible();

    const o = await overflow(page);
    expect(o, `board com transbordo horizontal de ${o}px`).toBeLessThanOrEqual(1);
  });
});
