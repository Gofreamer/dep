import { expect, test } from '@playwright/test';
import { chooseActiveAgent, expectNoConsoleErrors, toMenu, watchConsole } from './helpers';

/**
 * Fumaça: o app de produção carrega, navega e não quebra. Roda em Chromium e
 * Firefox — é o teste mínimo que precisa passar em qualquer navegador.
 */

test.describe('fumaça (desktop)', () => {
  test('a página inicial carrega sem erro de console', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await expect(page.getByTestId('title-screen')).toBeVisible();
    await expect(page).toHaveTitle(/JET/i);
    expectNoConsoleErrors(errors);
  });

  test('o menu final apresenta as 8 entradas em PT-BR', async ({ page }) => {
    const errors = watchConsole(page);
    await toMenu(page);
    const expected = [
      ['menu-play', 'Jogar vs IA'],
      ['menu-multiplayer', 'Multiplayer privado'],
      ['menu-ranked', 'Liga Ranqueada'],
      ['menu-tutorial', 'Tutorial'],
      ['menu-builder', 'Baralhos'],
      ['menu-collection', 'Coleção'],
      ['menu-history', 'Histórico'],
      ['menu-settings', 'Ajustes']
    ] as const;
    for (const [testId, label] of expected) {
      await expect(page.getByTestId(testId)).toBeVisible();
      await expect(page.getByTestId(testId)).toContainText(label);
    }
    // o menu tem exatamente 8 entradas e nenhuma delas é de debug
    await expect(page.locator('.menu-card')).toHaveCount(8);
    await expect(page.getByTestId('menu-screen')).not.toContainText(/debug/i);
    expectNoConsoleErrors(errors);
  });

  test('partida contra a IA chega ao board com mão e turno', async ({ page }) => {
    const errors = watchConsole(page);
    await toMenu(page);
    await page.getByTestId('menu-play').click();
    await expect(page.getByTestId('deck-select-screen')).toBeVisible();
    // os 3 baralhos iniciais oficiais
    for (const id of ['deck-jet-kof-12', 'deck-jet-asgard', 'deck-jet-morning-star']) {
      await expect(page.getByTestId(`deck-option-${id}`)).toBeVisible();
    }
    await page.getByTestId('deck-start').click();
    await expect(page.getByTestId('match-screen')).toBeVisible();
    await expect(page.getByTestId('hand')).toBeVisible();
    // "Pronto" só existe depois de escolher o Agente Base
    await chooseActiveAgent(page);
    await page.getByTestId('setup-done').click();
    await expect(page.getByTestId('end-turn')).toBeVisible({ timeout: 20_000 });
    expectNoConsoleErrors(errors);
  });

  test('tutorial abre e mostra o banner guiado', async ({ page }) => {
    const errors = watchConsole(page);
    await toMenu(page);
    await page.getByTestId('menu-tutorial').click();
    await expect(page.getByTestId('match-screen')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('tutorial-banner')).toBeVisible({ timeout: 20_000 });
    expectNoConsoleErrors(errors);
  });

  test('coleção, histórico e ajustes abrem', async ({ page }) => {
    const errors = watchConsole(page);
    await toMenu(page);
    for (const [testId, screen] of [
      ['menu-collection', 'collection-screen'],
      ['menu-history', 'history-screen'],
      ['menu-settings', 'settings-screen']
    ] as const) {
      await page.getByTestId(testId).click();
      await expect(page.getByTestId(screen)).toBeVisible();
      // o app não tem router: a volta é o botão "← Voltar" de cada tela
      await page.getByRole('button', { name: /Voltar/ }).click();
      await expect(page.getByTestId('menu-screen')).toBeVisible();
    }
    expectNoConsoleErrors(errors);
  });
});
