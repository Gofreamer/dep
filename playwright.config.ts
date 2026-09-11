import { defineConfig, devices } from '@playwright/test';

/**
 * JET TCG — testes E2E de navegador.
 *
 * Sobem o build de produção (`npm run build`) e o servem com `vite preview`
 * em 127.0.0.1:4173. É o mesmo artefato que vai para o Pages, então o que
 * passa aqui passa no deploy.
 *
 *   npm run test:e2e              # chromium desktop + firefox + mobile + tablet
 *   npm run test:e2e -- --headed  # com janela
 *
 * O fluxo multiplayer (e2e/multiplayer.spec.ts) precisa do Worker local:
 *   npm run worker:dev            # num terminal
 *   JET_WORKER_URL=http://127.0.0.1:8787 VITE_MULTIPLAYER_URL=http://127.0.0.1:8787 npm run build
 *   JET_WORKER_URL=http://127.0.0.1:8787 npm run test:e2e
 * Sem JET_WORKER_URL ele é pulado (nunca falha por falta de servidor).
 */

const PORT = Number(process.env.PORT ?? 4173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: ['**/responsive.spec.ts']
    },
    {
      name: 'desktop-firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1366, height: 768 } },
      testMatch: ['**/smoke.spec.ts']
    },
    {
      name: 'mobile-touch',
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
      testMatch: ['**/responsive.spec.ts']
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true },
      testMatch: ['**/responsive.spec.ts']
    }
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        stdout: 'pipe',
        stderr: 'pipe'
      }
});
