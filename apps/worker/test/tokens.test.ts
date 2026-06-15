import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { GameRoom } from '../src/GameRoom.js';

type Tokens = Record<string, string>;
type SocketMeta = { playerId: string };

/** Open a (hibernatable) seat socket for `pid` on the given room's Durable Object. */
async function connect(stub: DurableObjectStub, code: string, pid: string): Promise<void> {
  const res = await stub.fetch(`https://room/${code}/ws?pid=${pid}&name=${pid}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  // Accept the client end so the server-side seat socket stays live.
  res.webSocket?.accept();
}

/** Read the persisted per-seat token map straight out of DO storage. */
function tokenKeys(stub: DurableObjectStub): Promise<string[]> {
  return runInDurableObject(stub, async (_instance, state) => {
    const tokens = (await state.storage.get<Tokens>('tokens')) ?? {};
    return Object.keys(tokens).sort();
  });
}

describe('GameRoom seat tokens', () => {
  it('releases a lobby player\'s seat token when they disconnect (no unbounded growth)', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('TOKENS1'));
    await connect(stub, 'TOKENS1', 'p1');
    await connect(stub, 'TOKENS1', 'p2');

    // Both seats are tokenized while connected.
    expect(await tokenKeys(stub)).toEqual(['p1', 'p2']);

    // p1 disconnects from the lobby. Their token must be released; p2's retained.
    await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const p1ws = state.getWebSockets().find((ws) => {
        const meta = ws.deserializeAttachment() as SocketMeta | null;
        return meta?.playerId === 'p1';
      });
      expect(p1ws).toBeDefined();
      await (instance as unknown as { webSocketClose(ws: WebSocket): Promise<void> }).webSocketClose(p1ws!);
    });

    expect(await tokenKeys(stub)).toEqual(['p2']);
  });

  it('keeps a token across a transient disconnect once the game has started', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('TOKENS2'));
    await connect(stub, 'TOKENS2', 'a');
    await connect(stub, 'TOKENS2', 'b');

    // Start the game so we leave the lobby (host is the first joiner, 'a').
    await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const aws = state.getWebSockets().find((ws) => {
        const meta = ws.deserializeAttachment() as SocketMeta | null;
        return meta?.playerId === 'a';
      });
      await (instance as unknown as {
        dispatch(ws: WebSocket, pid: string, msg: { t: 'start_game' }): Promise<void>;
      }).dispatch(aws!, 'a', { t: 'start_game' });
    });

    // A mid-game disconnect must NOT drop the seat token — the player can reclaim
    // their seat on reconnect (only lobby leaves release the token).
    await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const bws = state.getWebSockets().find((ws) => {
        const meta = ws.deserializeAttachment() as SocketMeta | null;
        return meta?.playerId === 'b';
      });
      await (instance as unknown as { webSocketClose(ws: WebSocket): Promise<void> }).webSocketClose(bws!);
    });

    expect(await tokenKeys(stub)).toEqual(['a', 'b']);
  });
});
