import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { CardType } from '@ek/shared';
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

/** Open a read-only spectator socket (no seat, no token). */
async function connectSpectator(stub: DurableObjectStub, code: string, pid: string): Promise<void> {
  const res = await stub.fetch(`https://room/${code}/ws?pid=${pid}&name=${pid}&spectate=1`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
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

function avatarsOf(stub: DurableObjectStub): Promise<string[]> {
  return runInDurableObject(stub, async (_i, state) => {
    const g = (await state.storage.get<{ players: { avatar: string }[] }>('game'))!;
    return g.players.map((p) => p.avatar);
  });
}

describe('GameRoom avatars', () => {
  it('gives each joining player a distinct avatar (prefers unused)', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('AVATARS1'));
    await connect(stub, 'AVATARS1', 'a');
    await connect(stub, 'AVATARS1', 'b');
    await connect(stub, 'AVATARS1', 'c');
    const avatars = await avatarsOf(stub);
    expect(avatars).toHaveLength(3);
    expect(new Set(avatars).size).toBe(3); // all different while the set isn't exhausted
  });
});

describe('GameRoom Nope cooldown', () => {
  it('ignores a second Nope landing within the cooldown (no accidental Yup)', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('NOPECD1'));
    await connect(stub, 'NOPECD1', 'a'); // host
    await connect(stub, 'NOPECD1', 'b');
    await connect(stub, 'NOPECD1', 'c');
    await dispatchAs(stub, 'a', { t: 'start_game' });

    // Force a clean pending action by 'a' and hand 'b' and 'c' a Nope each.
    await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const inst = instance as unknown as {
        game: {
          pending?: unknown;
          players: { id: string; hand: { id: string; type: string }[] }[];
        };
        lastNopeAt: number | null;
      };
      const b = inst.game.players.find((p) => p.id === 'b')!;
      const c = inst.game.players.find((p) => p.id === 'c')!;
      b.hand.push({ id: 'nope-b', type: CardType.Nope });
      c.hand.push({ id: 'nope-c', type: CardType.Nope });
      inst.game.pending = { by: 'a', kind: CardType.Attack, playedCardIds: [], nopes: 0 };
      inst.lastNopeAt = null;
      await state.storage.put('game', inst.game);
    });

    // Two Nopes in immediate succession (well within the cooldown): the first
    // applies (nopes -> 1), the second is dropped, so it never becomes a Yup.
    await dispatchAs(stub, 'b', { t: 'nope', cardId: 'nope-b' });
    await dispatchAs(stub, 'c', { t: 'nope', cardId: 'nope-c' });

    const nopes = await runInDurableObject(stub, async (_i, state) => {
      const g = (await state.storage.get<{ pending?: { nopes: number } }>('game'))!;
      return g.pending?.nopes;
    });
    expect(nopes).toBe(1);
  });
});

describe('GameRoom spectators', () => {
  it('watches without taking a seat or a token', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('SPEC1'));
    await connect(stub, 'SPEC1', 'a');
    await connect(stub, 'SPEC1', 'b');
    await dispatchAs(stub, 'a', { t: 'start_game' });

    await connectSpectator(stub, 'SPEC1', 'watcher');

    // The spectator is not added as a player and holds no seat token.
    const players = await runInDurableObject(stub, async (_i, state) => {
      const g = (await state.storage.get<{ players: { id: string }[] }>('game'))!;
      return g.players.map((p) => p.id);
    });
    expect(players).toEqual(['a', 'b']);
    expect(await tokenKeys(stub)).toEqual(['a', 'b']); // 'watcher' absent

    // A frame from the spectator socket is ignored (read-only).
    await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const sws = state.getWebSockets().find((w) => {
        const meta = w.deserializeAttachment() as (SocketMeta & { spectator?: boolean }) | null;
        return meta?.spectator === true;
      });
      expect(sws).toBeDefined();
      await (instance as unknown as {
        webSocketMessage(ws: WebSocket, raw: string): Promise<void>;
      }).webSocketMessage(sws!, JSON.stringify({ t: 'set_name', name: 'hacker' }));
    });
    // Nothing changed.
    expect(await gamePhase(stub)).toBe('playing');
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
