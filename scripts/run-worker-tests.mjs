#!/usr/bin/env node
/**
 * Sobe o `wrangler dev` local (workerd + Durable Object), espera o /health e
 * roda `tests/worker-live.test.ts` contra ele. É o teste de integração real do
 * servidor multiplayer: não há mock de WebSocket nem de sala.
 *
 * Uso:  npm run test:worker
 *       PORT=8899 npm run test:worker
 */
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 180_000;

function log(...args) {
  process.stdout.write(`[worker-test] ${args.join(' ')}\n`);
}

async function waitHealth(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return (await res.json());
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`o worker não respondeu em ${BASE}/health dentro de ${TIMEOUT_MS}ms`);
}

// Se já houver um worker na porta, o health check passaria imediatamente contra
// o processo antigo e o teste rodaria contra código desatualizado. Aborta.
try {
  const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2_000) });
  if (res.ok) {
    log(`porta ${PORT} já tem um worker respondendo — encerre-o antes (ou use PORT=xxxx).`);
    process.exit(1);
  }
} catch {
  /* porta livre: é o que queremos */
}

const wrangler = spawn(
  'npx',
  ['wrangler', 'dev', '--config', 'worker/wrangler.toml', '--ip', '127.0.0.1', '--port', String(PORT), '--local'],
  { stdio: ['ignore', 'inherit', 'inherit'] }
);

let exitCode = 1;
try {
  log(`subindo wrangler dev em ${BASE} …`);
  const health = await waitHealth(Date.now() + TIMEOUT_MS);
  log(`pronto: ${JSON.stringify(health)}`);

  const vitest = spawn('npx', ['vitest', 'run', 'tests/worker-live.test.ts'], {
    stdio: 'inherit',
    env: { ...process.env, JET_WORKER_URL: BASE }
  });
  exitCode = await new Promise((resolve) => {
    vitest.on('exit', (code) => resolve(code ?? 1));
  });
} catch (err) {
  log('FALHA:', err instanceof Error ? err.message : String(err));
  exitCode = 1;
} finally {
  wrangler.kill('SIGTERM');
  setTimeout(() => wrangler.kill('SIGKILL'), 2_000).unref();
}

process.exit(exitCode);
