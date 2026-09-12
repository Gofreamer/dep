/**
 * AUTH — contas e sessões com hash salgado (PBKDF2) e limite de taxa.
 *
 *  - A senha NUNCA é armazenada em claro: só `salt` + `hash` (PBKDF2-SHA256).
 *  - O token de sessão é aleatório (256 bits) e expira.
 *  - Limite de taxa por IP+rota (janela deslizante em memória) nos endpoints
 *    de auth — contas só são necessárias para Liga Ranqueada/perfil/ladder;
 *    multiplayer privado e casual vs IA continuam sem login.
 */

export interface HashResult {
  salt: string;
  hash: string;
}

const PBKDF2_ITERATIONS = 120_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function subtle(): Promise<SubtleCrypto> {
  // Workers + Node 18+ expõem globalThis.crypto.subtle.
  const c = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto;
  if (!c?.subtle) throw new Error('WebCrypto indisponível neste runtime');
  return c.subtle;
}

/** Gera salt aleatório + hash PBKDF2-SHA256 da senha. */
export async function hashPassword(password: string): Promise<HashResult> {
  const s = await subtle();
  const saltBytes = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(saltBytes);
  const salt = toHex(saltBytes);
  const key = await s.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await s.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return { salt, hash: toHex(new Uint8Array(bits)) };
}

/** Verifica a senha contra um par salt+hash armazenado (tempo constante). */
export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const s = await subtle();
  const saltBytes = fromHex(salt);
  const key = await s.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await s.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  const actual = toHex(new Uint8Array(bits));
  if (actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}

export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function sessionTtl(): number {
  return SESSION_TTL_MS;
}

/** Normaliza o nome de usuário (case-insensitive, sem espaços nas bordas). */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 24);
}

export function isValidUsername(name: string): boolean {
  return /^[a-zA-Z0-9_\-]{3,24}$/.test(name);
}

// ---------------------------------------------------------------------------
// Rate limiting (janela deslizante em memória, por IP+rota)
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const buckets = new Map<string, { count: number; windowStart: number }>();

/** Limita tentativas por IP+rota. Retorna true se permitido. */
export function rateLimitOk(key: string, now = Date.now(), max = MAX_PER_WINDOW, windowMs = WINDOW_MS): boolean {
  const cur = buckets.get(key);
  if (!cur || now - cur.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  cur.count++;
  return cur.count <= max;
}

export function rateLimitKey(request: Request, route: string): string {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  return `${ip}:${route}`;
}

/** Testa se a senha tem tamanho mínimo razoável. */
export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}
