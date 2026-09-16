/**
 * JET TCG Worker — configuração de ambiente (sem segredos).
 *
 * `CLIENT_ORIGINS` é a ÚNICA variável necessária em produção: lista separada
 * por vírgula das origens permitidas para abrir WebSocket. Em desenvolvimento
 * os `localhost` do Vite são permitidos por padrão.
 */

export const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173'
];

export interface WorkerConfig {
  /** Origens permitidas (lowercase, sem barra final). `*` desativa o filtro. */
  allowedOrigins: string[];
  allowAnyOrigin: boolean;
}

export function parseOrigins(raw: string | undefined): WorkerConfig {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean);
  if (list.length === 0) return { allowedOrigins: [...DEFAULT_DEV_ORIGINS], allowAnyOrigin: false };
  if (list.includes('*')) return { allowedOrigins: [], allowAnyOrigin: true };
  return { allowedOrigins: [...new Set([...list, ...DEFAULT_DEV_ORIGINS])], allowAnyOrigin: false };
}

/**
 * Verifica a origem do handshake. WebSocket não usa CORS — a checagem do
 * cabeçalho `Origin` é o controle real contra uso não autorizado.
 * Requisições sem `Origin` (curl, healthcheck) NÃO recebem WebSocket.
 */
export function isAllowedOrigin(origin: string | null, cfg: WorkerConfig): boolean {
  if (!origin) return false;
  if (cfg.allowAnyOrigin) return true;
  const normalized = origin.trim().toLowerCase().replace(/\/+$/, '');
  return cfg.allowedOrigins.includes(normalized);
}

export function corsHeaders(origin: string | null, cfg: WorkerConfig): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (origin && isAllowedOrigin(origin, cfg)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type, authorization';
    headers['vary'] = 'Origin';
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Segredo da Liga Ranqueada — FALHA FECHADA em produção
// ---------------------------------------------------------------------------

/** Segredo de desenvolvimento: NUNCA aceitável fora de dev explícito. */
export const DEV_RANKED_SECRET = 'dev-secret-change-me';
/** Tamanho mínimo de um segredo de produção (256 bits em hex ≥ 32 chars). */
export const MIN_SECRET_LENGTH = 32;

/** Só o que as rotas da Liga precisam ler do ambiente. */
export interface RankedEnvLike {
  JET_RANKED_SECRET?: string;
  ALLOW_INSECURE_ORIGIN?: string;
  NODE_ENV?: string;
}

export type SecretResult = { ok: true; secret: string; devFallback: boolean } | { ok: false; error: string };

/**
 * Resolve o segredo de assinatura de tickets.
 *
 * - produção (default): exige `JET_RANKED_SECRET` com ≥32 caracteres. Sem isso,
 *   as rotas da Liga respondem 503 em vez de assinar tickets com uma chave que
 *   qualquer pessoa que leia o repositório também conhece (o fallback `'dev-
 *   secret-change-me'` da 2.0 permitia forjar ticket de partida ranqueada).
 * - dev: só aceita o fallback com opt-in EXPLÍCITO (`NODE_ENV=development` ou
 *   `ALLOW_INSECURE_ORIGIN=1`, os mesmos sinais usados para liberar origem).
 */
export function resolveRankedSecret(env: RankedEnvLike | undefined | null): SecretResult {
  const raw = typeof env?.JET_RANKED_SECRET === 'string' ? env.JET_RANKED_SECRET.trim() : '';
  const devOk = env?.NODE_ENV === 'development' || env?.NODE_ENV === 'test' || env?.ALLOW_INSECURE_ORIGIN === '1';
  if (raw) {
    if (raw.length < MIN_SECRET_LENGTH) {
      return { ok: false, error: `JET_RANKED_SECRET muito curto (${raw.length} < ${MIN_SECRET_LENGTH} caracteres)` };
    }
    return { ok: true, secret: raw, devFallback: raw === DEV_RANKED_SECRET };
  }
  if (devOk) return { ok: true, secret: DEV_RANKED_SECRET, devFallback: true };
  return { ok: false, error: 'JET_RANKED_SECRET ausente — defina a variável no Worker (wrangler secret put JET_RANKED_SECRET)' };
}
