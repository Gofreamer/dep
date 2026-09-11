/**
 * JET TCG Worker — entrada HTTP/WebSocket.
 *
 * Rotas:
 *   GET  /health          → { ok, protocolVersion } (com CORS para origens ok)
 *   GET  /                → página de diagnóstico curta
 *   WS   /room/new        → cria sala (devolve o código no primeiro JOINED)
 *   WS   /room/:CODE      → entra numa sala existente pelo código
 *
 * Segurança:
 *  - `Origin` é checado ANTES do upgrade (WebSocket não usa CORS);
 *  - apenas GET é aceito; nada é executado a partir do corpo;
 *  - nenhum segredo é lido do request; `CLIENT_ORIGINS` vem do ambiente.
 */

import { PROTOCOL_VERSION } from '../../src/net/protocol';
import { RoomDO, allocateRoomCode } from './room';
import { corsHeaders, isAllowedOrigin, parseOrigins } from './config';

export { RoomDO };

export interface Env {
  JET_ROOM: DurableObjectNamespace;
  CLIENT_ORIGINS?: string;
  ALLOW_INSECURE_ORIGIN?: string;
}

const INFO_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>JET TCG — servidor de sala</title></head>
<body style="font-family:system-ui,sans-serif;background:#0b0e1a;color:#e6e9f2;padding:32px;max-width:640px;margin:auto">
<h1>JET TCG · servidor de sala privada</h1>
<p>Este serviço só atende WebSocket do jogo. Abra o jogo e use
<strong>Multiplayer privado</strong> para criar ou entrar numa sala.</p>
<p>Protocolo: v${PROTOCOL_VERSION}</p>
</body></html>`;

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cfg = parseOrigins(env.CLIENT_ORIGINS);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, cfg) });
    }
    if (request.method !== 'GET') {
      return new Response('method not allowed', { status: 405, headers: corsHeaders(origin, cfg) });
    }

    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({ ok: true, service: 'jet-tcg-multiplayer', protocolVersion: PROTOCOL_VERSION }),
        { status: 200, headers: corsHeaders(origin, cfg) }
      );
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(INFO_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    // --- WebSocket ---------------------------------------------------------
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('rota somente para WebSocket', { status: 404, headers: corsHeaders(origin, cfg) });
    }
    if (env.ALLOW_INSECURE_ORIGIN !== '1' && !isAllowedOrigin(origin, cfg)) {
      return new Response('forbidden', { status: 403 });
    }

    if (url.pathname === '/room/new') {
      let code: string;
      try {
        code = await allocateRoomCode(env);
      } catch (err) {
        console.error('[worker] falha ao alocar sala', err);
        return new Response('unavailable', { status: 503 });
      }
      return proxyToRoom(env, code, request);
    }

    const match = url.pathname.match(/^\/room\/([A-Za-z0-9]{4,10})$/);
    if (!match) return new Response('rota desconhecida', { status: 404, headers: corsHeaders(origin, cfg) });
    return proxyToRoom(env, match[1].toUpperCase(), request);
  }
};

export default worker;

/** Encaminha o upgrade para o Durable Object da sala. */
function proxyToRoom(env: Env, code: string, request: Request): Promise<Response> {
  const stub = env.JET_ROOM.get(env.JET_ROOM.idFromName(code));
  return stub.fetch(
    new Request(`https://room.internal/session?code=${encodeURIComponent(code)}`, {
      headers: request.headers
    })
  );
}
