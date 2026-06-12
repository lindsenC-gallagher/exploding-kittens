import { GameRoom } from './GameRoom.js';

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
const ROOM_CODE_LENGTH = 4;

function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  let code = '';
  for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
  return code;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // Create a new room: returns a fresh room code.
    if (request.method === 'POST' && path === '/api/rooms') {
      const code = generateRoomCode();
      return json({ code });
    }

    // WebSocket upgrade for a specific room: /api/rooms/:code/ws
    const wsMatch = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/ws$/);
    if (wsMatch) {
      const code = wsMatch[1].toUpperCase();
      const id = env.GAME_ROOM.idFromName(code);
      const stub = env.GAME_ROOM.get(id);
      // Forward the original request (with Upgrade header + query string) to the DO.
      const forward = new Request(`https://room/${code}/ws${url.search}`, request);
      return stub.fetch(forward);
    }

    if (path === '/api/health') return json({ ok: true });

    return new Response('Not found', { status: 404, headers: CORS });
  },
};

export { GameRoom };
