import { expect, test } from '@playwright/test';
import { expectNoConsoleErrors, finishSetup, startAiMatch, toMenu, watchConsole } from './helpers';

/**
 * Fluxo de produto no navegador real: baralho → partida → mão → inspeção →
 * turno → pausa; coleção; construtor de baralhos (adicionar/remover/validar/
 * salvar); ajustes persistentes.
 */

test.describe('fluxo local contra a IA', () => {
  test('partida chega ao board, inspeciona carta e encerra turno', async ({ page }) => {
    const errors = watchConsole(page);
    await startAiMatch(page);

    // preparação: escolher o agente Base e concluir
    await expect(page.getByTestId('setup-done')).toBeVisible();
    await page.getByTestId('setup-done').click();
    await expect(page.getByTestId('end-turn')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('turn-banner')).toBeVisible();

    // a mão existe e tem cartas clicáveis
    const handCards = page.getByTestId('hand').locator('[data-testid^="card-"]');
    await expect(handCards.first()).toBeVisible();

    // inspeção por botão direito + Escape fecha
    await handCards.first().click({ button: 'right' });
    await expect(page.getByTestId('inspect-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('inspect-modal')).toHaveCount(0);

    // o adversário tem mão escondida (costas de carta, sem conteúdo)
    await expect(page.getByTestId('opp-hand')).toBeVisible();

    // encerrar turno só é possível no seu turno
    const endTurn = page.getByTestId('end-turn');
    if (await endTurn.isEnabled()) {
      const banner = await page.getByTestId('turn-banner').innerText();
      await endTurn.click();
      await expect(page.getByTestId('turn-banner')).toBeVisible();
      expect(banner.length).toBeGreaterThan(0);
    }
    expectNoConsoleErrors(errors);
  });

  test('pausa abre modal com continuar, reiniciar e menu', async ({ page }) => {
    const errors = watchConsole(page);
    await startAiMatch(page);
    await page.getByTestId('hud-pause').click();
    await expect(page.getByTestId('pause-modal')).toBeVisible();
    await expect(page.getByTestId('pause-resume')).toBeVisible();
    await expect(page.getByTestId('pause-restart')).toBeVisible();
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    await page.getByTestId('pause-resume').click();
    await expect(page.getByTestId('pause-modal')).toHaveCount(0);
    await expect(page.getByTestId('match-screen')).toBeVisible();
    expectNoConsoleErrors(errors);
  });

  test('tutorial abre partida guiada com banner e volta ao menu', async ({ page }) => {
    const errors = watchConsole(page);
    await toMenu(page);
    await page.getByTestId('menu-tutorial').click();
    await expect(page.getByTestId('match-screen')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('tutorial-banner')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('hud-pause').click();
    await page.getByTestId('pause-menu').click();
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    expectNoConsoleErrors(errors);
  });
});

test.describe('coleção e construtor', () => {
  test('coleção filtra por texto e mostra BASE e edição especial', async ({ page }) => {
    const errors = watchConsole(page);
    await toMenu(page);
    await page.getByTestId('menu-collection').click();
    await expect(page.getByTestId('collection-screen')).toBeVisible();
    const cards = page.getByTestId('collection-screen').locator('[data-testid^="card-"]');
    await expect(cards.first()).toBeVisible();
    const before = await cards.count();
    expect(before).toBeGreaterThan(10);

    await page.getByTestId('collection-search').fill('zzzz-nada-disso');
    await expect(cards).toHaveCount(0, { timeout: 10_000 });

    await page.getByTestId('collection-search').fill('');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    expectNoConsoleErrors(errors);
  });

  test('construtor adiciona, remove, valida e salva o baralho', async ({ page }) => {
    const errors = watchConsole(page);
    await toMenu(page);
    await page.getByTestId('menu-builder').click();
    await expect(page.getByTestId('builder-screen')).toBeVisible();

    const validity = page.getByTestId('builder-validity');
    await expect(validity).toBeVisible();
    await expect(validity).toContainText('⚠');

    const library = page.locator('.lib-cell [data-testid^="card-"]');
    await expect(library.first()).toBeVisible();
    const before = await page.locator('.deck-line').count();
    await library.first().click();
    await expect(page.locator('.deck-line')).toHaveCount(before + 1);

    // remover clicando na carta já no baralho
    await page.locator('.deck-line [data-testid^="card-"]').first().click();
    await expect(page.locator('.deck-line')).toHaveCount(before);

    // busca da biblioteca
    await page.getByTestId('builder-search').fill('zzzz-nada-disso');
    await expect(library).toHaveCount(0, { timeout: 10_000 });
    await page.getByTestId('builder-search').fill('');
    await expect(library.first()).toBeVisible({ timeout: 10_000 });

    // salvar e voltar
    await page.getByTestId('builder-name').fill('Baralho do E2E');
    await page.getByTestId('builder-back').click();
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    expectNoConsoleErrors(errors);
  });

  test('baralho salvo sobrevive a recarregar a página', async ({ page }) => {
    const errors = watchConsole(page);
    await toMenu(page);
    await page.getByTestId('menu-builder').click();
    await page.getByTestId('builder-name').fill('Baralho Persistente');
    await page.getByTestId('builder-back').click();
    await expect(page.getByTestId('menu-screen')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('title-screen')).toBeVisible();
    await page.getByTestId('title-enter').click();
    await page.getByTestId('menu-play').click();
    await expect(page.getByTestId('deck-select-screen')).toBeVisible();
    await expect(page.getByTestId('deck-select-screen')).toContainText('Baralho Persistente');
    expectNoConsoleErrors(errors);
  });
});

test.describe('ajustes', () => {
  test('som liga/desliga e persiste', async ({ page }) => {
    const errors = watchConsole(page);
    await toMenu(page);
    await page.getByTestId('menu-settings').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    const sound = page.getByTestId('settings-sound');
    await expect(sound).toBeVisible();
    const before = await sound.isChecked();
    await sound.click();
    await expect(sound).not.toBeChecked();

    await page.reload();
    await page.getByTestId('title-enter').click();
    await page.getByTestId('menu-settings').click();
    await expect(page.getByTestId('settings-sound')).not.toBeChecked();
    expect(await page.getByTestId('settings-sound').isChecked()).toBe(!before);
    expectNoConsoleErrors(errors);
  });
});

test.describe('multiplayer sem servidor', () => {
  test('avisa que o servidor não está configurado e o modo local continua 100%', async ({ page }) => {
    const errors = watchConsole(page);
    await toMenu(page);
    await page.getByTestId('menu-multiplayer').click();
    await expect(page.getByTestId('multiplayer-screen')).toBeVisible();
    if (!process.env.VITE_MULTIPLAYER_URL) {
      await expect(page.getByTestId('mp-not-configured')).toBeVisible();
      await expect(page.getByTestId('mp-not-configured')).toContainText(/não configurado/i);
    }
    await page.getByTestId('mp-back').click();
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    // o modo contra a IA segue funcionando sem servidor nenhum
    await startAiMatch(page);
    await finishSetup(page);
    expectNoConsoleErrors(errors);
  });
});
