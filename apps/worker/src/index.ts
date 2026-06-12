import { GameRoom } from './GameRoom.js';

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  /** Static-asset store binding (the built React app). */
  ASSETS: Fetcher;
  /**
   * Optional comma-separated origin allowlist applied to CORS and the WebSocket
   * upgrade. When unset, a sensible default (localhost + *.pages.dev / *.workers.dev)
   * is used. Set this to your exact production origin to lock things down.
   */
  ALLOWED_ORIGINS?: string;
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
// 32^6 ≈ 1.07e9 codes: resists enumeration and pushes the birthday bound for
// collisions out past any realistic concurrent-room count.
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4,8}$/;

/** Hardening headers for JSON API responses (no document is rendered from these). */
const API_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

/**
 * CSP + hardening headers for the served SPA. The production bundle loads its
 * script/style from same-origin files (no inline scripts), but React inline
 * `style={...}` props require 'unsafe-inline' for styles. The SPA talks to its
 * own origin, so connect-src 'self' covers the WebSocket.
 */
const ASSET_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
    "base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
};

function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  let code = '';
  for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
  return code;
}

function allowlist(env: Env): string[] | null {
  const raw = env.ALLOWED_ORIGINS?.trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Is this Origin allowed to call the API / open a socket? A missing Origin
 * (native clients, same-origin requests) is allowed. With ALLOWED_ORIGINS set
 * we match it exactly; otherwise we fall back to localhost plus Cloudflare
 * Pages/Workers subdomains so the default deployment works out of the box.
 */
function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return true;
  const list = allowlist(env);
  if (list) return list.includes(origin);
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return host.endsWith('.pages.dev') || host.endsWith('.workers.dev');
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  // Reflect only an allowed origin; otherwise omit ACAO so the browser blocks it.
  if (origin && isOriginAllowed(origin, env)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body: unknown, request: Request, env: Env, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...API_SECURITY_HEADERS,
      ...corsHeaders(request, env),
    },
  });
}

/** Serve a static asset / the SPA, layering on security headers (CSP, nosniff, …). */
async function serveAsset(request: Request, env: Env): Promise<Response> {
  const res = await env.ASSETS.fetch(request);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(ASSET_SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Backend API + realtime WebSocket. Everything else falls through to the
    // static React app (served by the ASSETS binding, SPA fallback configured).
    if (path.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders(request, env) });
      }

      // Create a new room: returns a fresh room code.
      if (request.method === 'POST' && path === '/api/rooms') {
        return json({ code: generateRoomCode() }, request, env);
      }

      // WebSocket upgrade for a specific room: /api/rooms/:code/ws
      const wsMatch = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/ws$/);
      if (wsMatch) {
        const code = wsMatch[1].toUpperCase();
        // Validate the code shape so we don't spin up Durable Objects for junk
        // names (bounds the DO namespace to the real ~1e9 code space).
        if (!ROOM_CODE_RE.test(code)) return new Response('Bad room code', { status: 400 });
        // WebSocket upgrades bypass CORS; check Origin to blunt cross-site hijacking.
        if (!isOriginAllowed(request.headers.get('Origin'), env)) {
          return new Response('Forbidden origin', { status: 403 });
        }
        const id = env.GAME_ROOM.idFromName(code);
        const stub = env.GAME_ROOM.get(id);
        // Forward the original request (with Upgrade header + query string) to the DO.
        const forward = new Request(`https://room/${code}/ws${url.search}`, request);
        return stub.fetch(forward);
      }

      if (path === '/api/health') return json({ ok: true }, request, env);

      return json({ error: 'Not found' }, request, env, 404);
    }

    // Serve the built React app (and SPA-route fallback to index.html).
    return serveAsset(request, env);
  },
};

export { GameRoom };
