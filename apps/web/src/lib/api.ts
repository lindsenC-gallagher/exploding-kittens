/**
 * Base URL for the worker API. Empty in dev (Vite proxies /api to the worker),
 * set to the deployed Worker origin in production (Cloudflare Pages build).
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/** Create a new room and return its code. */
export async function createRoom(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not create room');
  const data = (await res.json()) as { code: string };
  return data.code;
}

/** Build the WebSocket URL for a room. Uses the API base if set, else same-origin. */
export function roomSocketUrl(code: string, pid: string, name: string, token: string): string {
  const params = new URLSearchParams({ pid, name });
  if (token) params.set('token', token);
  let host = location.host;
  let secure = location.protocol === 'https:';
  if (API_BASE) {
    const u = new URL(API_BASE);
    host = u.host;
    secure = u.protocol === 'https:';
  }
  const proto = secure ? 'wss' : 'ws';
  return `${proto}://${host}/api/rooms/${code}/ws?${params.toString()}`;
}
