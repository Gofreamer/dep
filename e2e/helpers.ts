import { expect, type Page } from '@playwright/test';

/**
 * Helpers dos testes E2E.
 *
 * `watchConsole` ignora falha de carregamento de imagem de propósito: as artes
 * oficiais vêm de URLs remotas e o ambiente de CI pode não ter saída para a
 * internet. O jogo tem fallback procedural, então arte ausente NÃO é defeito.
 */
// As artes oficiais são servidas por um host remoto (github.com/…?raw=true).
// Falha de rede e o aviso do Firefox sobre cookie de terceiro partido nesse
// host NÃO são defeito do jogo — o resolver tem fallback procedural.
const BENIGN = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /ERR_INTERNET_DISCONNECTED/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /favicon/i,
  /Cookie .* has been rejected/i,
  /cross-site context/i,
  /SameSite/i
];

export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (BENIGN.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

export function expectNoConsoleErrors(errors: string[]): void {
  expect(errors, `erros de console: ${errors.join(' | ')}`).toEqual([]);
}

/** Título → menu principal. */
export async function toMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await page.getByTestId('title-enter').click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
}

/** Menu → partida contra a IA já na preparação (setup). */
export async function startAiMatch(page: Page, deckId = 'deck-jet-kof-12'): Promise<void> {
  await toMenu(page);
  await page.getByTestId('menu-play').click();
  await expect(page.getByTestId('deck-select-screen')).toBeVisible();
  await page.getByTestId(`deck-option-${deckId}`).click();
  await page.getByTestId('deck-start').click();
  await expect(page.getByTestId('match-screen')).toBeVisible();
  await expect(page.getByTestId('hand')).toBeVisible();
}

/**
 * Escolhe o Agente Base na preparação. O botão "Pronto" (`setup-done`) só
 * existe depois de `st.players[0].active` estar definido, então este passo é
 * obrigatório — cartas jogáveis na preparação não têm a classe `.dim`.
 */
export async function chooseActiveAgent(page: Page): Promise<void> {
  const playable = page.getByTestId('hand').locator('.card-mini.playable');
  await expect(playable.first()).toBeVisible({ timeout: 20_000 });
  await playable.first().click();
  await expect(page.getByTestId('setup-done')).toBeVisible({ timeout: 20_000 });
}

/** Escolhe o Ativo e conclui a preparação dos dois lados, esperando o turno 1. */
export async function finishSetup(page: Page): Promise<void> {
  await chooseActiveAgent(page);
  await page.getByTestId('setup-done').click();
  await expect(page.getByTestId('end-turn')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('turn-banner')).toContainText(/Turno/i, { timeout: 20_000 });
}
