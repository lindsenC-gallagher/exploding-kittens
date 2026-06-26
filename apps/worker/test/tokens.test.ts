import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { CardType, type ClientGameView } from '@ek/shared';
import type { GameRoom } from '../src/GameRoom.js';

type Tokens = Record<string, string>;
type SocketMeta = { playerId: string };
type SpectatorMeta = SocketMeta & {
  spectator?: boolean;
  spectatorReason?: string;
  waiting?: boolean;
};

/** Open a (hibernatable) seat socket for `pid` on the given room's Durable Object. */
async function connect(stub: DurableObjectStub, code: string, pid: string): Promise<void> {
  await connectSocket(stub, code, pid);
}

/** Open a socket for `pid` (seat or waiting, server decides) and return its client end. */
async function connectSocket(stub: DurableObjectStub, code: string, pid: string): Promise<WebSocket> {
  const res = await stub.fetch(`https://room/${code}/ws?pid=${pid}&name=${pid}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  // Accept the client end so the server-side socket stays live.
  ws.accept();
  return ws;
}

/** Open a read-only spectator socket (no seat, no token). */
async function connectSpectator(stub: DurableObjectStub, code: string, pid: string): Promise<void> {
  const res = await stub.fetch(`https://room/${code}/ws?pid=${pid}&name=${pid}&spectate=1`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  res.webSocket?.accept();
}

/**
 * Open a spectator socket and return its client end so a test can listen for the
 * server-pushed frames (views, events) the watcher receives.
 */
async function connectSpectatorSocket(
  stub: DurableObjectStub,
  code: string,
  pid: string,
): Promise<WebSocket> {
  const res = await stub.fetch(`https://room/${code}/ws?pid=${pid}&name=${pid}&spectate=1`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  return ws;
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
  it('parks a mid-game arrival on the waiting screen (no seat, no token, read-only)', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('SPEC1'));
    await connect(stub, 'SPEC1', 'a');
    await connect(stub, 'SPEC1', 'b');
    await dispatchAs(stub, 'a', { t: 'start_game' });

    // A mid-game arrival (even via the explicit watch link) is parked, not seated.
    await connectSpectator(stub, 'SPEC1', 'watcher');

    // The newcomer is not added as a player and holds no seat token.
    const players = await runInDurableObject(stub, async (_i, state) => {
      const g = (await state.storage.get<{ players: { id: string }[] }>('game'))!;
      return g.players.map((p) => p.id);
    });
    // Turn order is randomised on game start, so compare order-independently.
    expect([...players].sort()).toEqual(['a', 'b']);
    expect(await tokenKeys(stub)).toEqual(['a', 'b']); // 'watcher' absent

    // A frame from the waiting socket is ignored (read-only).
    await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const sws = state.getWebSockets().find((w) => {
        const meta = w.deserializeAttachment() as SpectatorMeta | null;
        return meta?.waiting === true;
      });
      expect(sws).toBeDefined();
      await (instance as unknown as {
        webSocketMessage(ws: WebSocket, raw: string): Promise<void>;
      }).webSocketMessage(sws!, JSON.stringify({ t: 'set_name', name: 'hacker' }));
    });
    // Nothing changed.
    expect(await gamePhase(stub)).toBe('playing');
  });

  it('receives the game-event stream so the spectator can show the game log', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('SPECLOG1'));
    await connect(stub, 'SPECLOG1', 'a'); // host
    await connect(stub, 'SPECLOG1', 'b');

    // Spectator joins before the game starts and listens for pushed frames.
    const sock = await connectSpectatorSocket(stub, 'SPECLOG1', 'watcher');
    const events: unknown[][] = [];
    sock.addEventListener('message', (ev) => {
      const msg = JSON.parse((ev as MessageEvent).data as string) as {
        t: string;
        events?: unknown[];
      };
      if (msg.t === 'events' && msg.events) events.push(msg.events);
    });

    // Starting the game broadcasts a `game_started` event to every socket,
    // spectators included — that's what feeds the spectator's game log.
    await dispatchAs(stub, 'a', { t: 'start_game' });

    const flat = events.flat() as { type: string }[];
    expect(flat.some((e) => e.type === 'game_started')).toBe(true);
  });

  it('parks a seat-less mid-game arrival as waiting with NO hidden info (no 403)', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('SPEC2'));
    await connect(stub, 'SPEC2', 'a');
    await connect(stub, 'SPEC2', 'b');
    await dispatchAs(stub, 'a', { t: 'start_game' });

    // 'watcher' has no seat and the game is underway. Instead of a 403 — or an
    // unfair unredacted spectate — they get a read-only WAITING socket and view.
    const views: ClientGameView[] = [];
    const ws = await connectSocket(stub, 'SPEC2', 'watcher');
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse((ev as MessageEvent).data as string) as {
        t: string;
        view?: ClientGameView;
      };
      if (msg.t === 'view' && msg.view) views.push(msg.view);
    });
    // Re-fetch the view now that the listener is attached (the first view raced).
    await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const sws = state.getWebSockets().find((w) => {
        const meta = w.deserializeAttachment() as SpectatorMeta | null;
        return meta?.playerId === 'watcher';
      });
      (instance as unknown as { sendView(w: WebSocket): void }).sendView(sws!);
    });

    const players = await runInDurableObject(stub, async (_i, state) => {
      const g = (await state.storage.get<{ players: { id: string }[] }>('game'))!;
      return g.players.map((p) => p.id);
    });
    expect([...players].sort()).toEqual(['a', 'b']); // watcher never seated
    expect(await tokenKeys(stub)).toEqual(['a', 'b']); // watcher holds no token

    // The watcher's socket is flagged waiting (so its frames are read-only) and
    // is NOT a spectator (so it never receives the reveal).
    const watcherMeta = await runInDurableObject(stub, async (_i, state) => {
      const w = state.getWebSockets().find((s) => {
        const meta = s.deserializeAttachment() as SpectatorMeta | null;
        return meta?.playerId === 'watcher';
      });
      return w?.deserializeAttachment() as SpectatorMeta | null;
    });
    expect(watcherMeta?.waiting).toBe(true);
    expect(watcherMeta?.spectator).toBeFalsy();

    // The waiting view carries no hidden information: no spectator reveal, no
    // other player's hand, no deck order.
    const last = views.at(-1)!;
    expect(last.isWaiting).toBe(true);
    expect(last.isSpectator).toBe(false);
    expect(last.spectator).toBeNull();
    expect(last.yourHand).toEqual([]);
  });

  it('seats a waiting newcomer when the host starts the next game (dealt a hand)', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('SPEC3'));
    await connect(stub, 'SPEC3', 'a'); // host
    await connect(stub, 'SPEC3', 'b');
    await dispatchAs(stub, 'a', { t: 'start_game' });

    // 'late' arrives mid-game and is parked as waiting.
    await connect(stub, 'SPEC3', 'late');
    expect(await tokenKeys(stub)).toEqual(['a', 'b']);

    // Force the game to finish, then the host returns everyone to the lobby.
    await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const inst = instance as unknown as { game: { phase: string; winnerId?: string } };
      inst.game.phase = 'gameOver';
      inst.game.winnerId = 'a';
      await state.storage.put('game', inst.game);
    });
    await dispatchAs(stub, 'a', { t: 'play_again' });
    expect(await gamePhase(stub)).toBe('lobby');

    // The waiting newcomer is now a seated player with a token.
    const players = await runInDurableObject(stub, async (_i, state) => {
      const g = (await state.storage.get<{ players: { id: string }[] }>('game'))!;
      return g.players.map((p) => p.id);
    });
    expect([...players].sort()).toEqual(['a', 'b', 'late']);
    expect(await tokenKeys(stub)).toEqual(['a', 'b', 'late']);

    // And the next game deals them a hand like any other seated player.
    await dispatchAs(stub, 'a', { t: 'start_game' });
    expect(await gamePhase(stub)).toBe('playing');
    const lateHand = await runInDurableObject(stub, async (_i, state) => {
      const g = (await state.storage.get<{ players: { id: string; hand: unknown[] }[] }>('game'))!;
      return g.players.find((p) => p.id === 'late')?.hand.length ?? 0;
    });
    expect(lateHand).toBeGreaterThan(0);
  });

  it('still gives an eliminated seated player the unredacted reveal', async () => {
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName('SPEC4'));
    await connect(stub, 'SPEC4', 'a'); // host
    await connect(stub, 'SPEC4', 'b');
    await dispatchAs(stub, 'a', { t: 'start_game' });

    // Knock 'b' out (they played and saw the game, so the reveal is fair).
    await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const inst = instance as unknown as {
        game: { players: { id: string; alive: boolean; hand: unknown[] }[] };
      };
      const b = inst.game.players.find((p) => p.id === 'b')!;
      b.alive = false;
      b.hand = [];
      await state.storage.put('game', inst.game);
    });

    // 'b''s own socket gets a spectator reveal (all hands + deck), reason eliminated.
    const view = await runInDurableObject(stub, async (instance: GameRoom, state) => {
      const captured: ClientGameView[] = [];
      const bws = state.getWebSockets().find((w) => {
        const meta = w.deserializeAttachment() as SocketMeta | null;
        return meta?.playerId === 'b';
      })!;
      const orig = bws.send.bind(bws);
      // Intercept the next pushed frame to read the projected view.
      (bws as unknown as { send(d: string): void }).send = (d: string) => {
        const m = JSON.parse(d) as { t: string; view?: ClientGameView };
        if (m.t === 'view' && m.view) captured.push(m.view);
        orig(d);
      };
      (instance as unknown as { sendView(w: WebSocket): void }).sendView(bws);
      return captured.at(-1)!;
    });
    expect(view.isSpectator).toBe(true);
    expect(view.isWaiting).toBe(false);
    expect(view.spectator?.reason).toBe('eliminated');
    expect(view.spectator?.hands.length).toBeGreaterThan(0);
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
