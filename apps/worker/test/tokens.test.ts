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

/** Dispatch a client message as `pid` through the room's private handler. */
async function dispatchAs(stub: DurableObjectStub, pid: string, msg: unknown): Promise<void> {
  await runInDurableObject(stub, async (instance: GameRoom, state) => {
    const ws = state.getWebSockets().find((w) => {
      const meta = w.deserializeAttachment() as SocketMeta | null;
      return meta?.playerId === pid;
    });
    await (instance as unknown as {
      dispatch(ws: WebSocket, pid: string, msg: unknown): Promise<void>;
    }).dispatch(ws!, pid, msg);
  });
}

function gamePhase(stub: DurableObjectStub): Promise<string> {
  return runInDurableObject(stub, async (_i, state) => {
    const g = (await state.storage.get<{ phase: string }>('game'))!;
    return g.phase;
  });
}

function nameOf(stub: DurableObjectStub, pid: string): Promise<string | undefined> {
  return runInDurableObject(stub, async (_i, state) => {
    const g = (await state.storage.get<{ players: { id: string; name: string }[] }>('game'))!;
    return g.players.find((p) => p.id === pid)?.name;
  });
}

describe('GameRoom play again', () => {
  it('lets only the host reset a finished game back to the lobby', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('AGAIN1'));
    await connect(stub, 'AGAIN1', 'a'); // host (first joiner)
    await connect(stub, 'AGAIN1', 'b');

    await dispatchAs(stub, 'a', { t: 'start_game' });
    expect(await gamePhase(stub)).toBe('playing');

    // Force the game to a finished state (both the live instance and storage).
    await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const inst = instance as unknown as { game: { phase: string; winnerId?: string } };
      inst.game.phase = 'gameOver';
      inst.game.winnerId = 'a';
      await state.storage.put('game', inst.game);
    });
    expect(await gamePhase(stub)).toBe('gameOver');

    // A non-host cannot reset.
    await dispatchAs(stub, 'b', { t: 'play_again' });
    expect(await gamePhase(stub)).toBe('gameOver');

    // The host can — back to the lobby with the same seats retained.
    await dispatchAs(stub, 'a', { t: 'play_again' });
    expect(await gamePhase(stub)).toBe('lobby');
    expect(await tokenKeys(stub)).toEqual(['a', 'b']);
  });
});

describe('GameRoom rename', () => {
  it('renames a seat in the lobby (clamped) but not once the game has started', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('RENAME1'));
    await connect(stub, 'RENAME1', 'a'); // host
    await connect(stub, 'RENAME1', 'b');

    // In the lobby, a player can rename themselves; the name is clamped/trimmed.
    await dispatchAs(stub, 'b', { t: 'set_name', name: '  Sir Whiskers the Third of Catington  ' });
    expect(await nameOf(stub, 'b')).toBe('Sir Whiskers the Thi'); // trimmed + 20-char cap

    // Start the game; renames are now ignored.
    await dispatchAs(stub, 'a', { t: 'start_game' });
    await dispatchAs(stub, 'b', { t: 'set_name', name: 'TooLate' });
    expect(await nameOf(stub, 'b')).toBe('Sir Whiskers the Thi');
  });
});
