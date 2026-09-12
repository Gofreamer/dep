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
