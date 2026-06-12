import {
  addPlayer,
  applyAction,
  createLobby,
  projectView,
  shuffle,
  createRng,
  startGame,
  RULES,
  CardType,
  type ClientMessage,
  type GameEvent,
  type GameState,
  type ServerMessage,
} from '@ek/shared';
import type { Env } from './index.js';

interface SocketMeta {
  playerId: string;
}

/**
 * One Durable Object instance per room code. Holds the authoritative GameState,
 * owns every connected WebSocket, runs the engine, and broadcasts redacted
 * per-player views. The Nope window is implemented with a DO alarm so it
 * survives hibernation.
 */
export class GameRoom {
  private ctx: DurableObjectState;
  private game!: GameState;
  private roomCode = '';
  private loaded = false;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.ctx.storage.get<GameState>('game');
    const code = await this.ctx.storage.get<string>('code');
    this.game = stored ?? createLobby('');
    this.roomCode = code ?? '';
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('game', this.game);
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);
    const match = url.pathname.match(/\/([A-Za-z0-9]+)\/ws$/);
    if (!match) return new Response('Bad room path', { status: 400 });
    if (!this.roomCode) {
      this.roomCode = match[1].toUpperCase();
      await this.ctx.storage.put('code', this.roomCode);
    }

    const pid = url.searchParams.get('pid');
    const name = (url.searchParams.get('name') ?? 'Player').slice(0, 20);
    if (!pid) return new Response('Missing pid', { status: 400 });

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Use hibernation; stash the player id on the socket.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: pid } satisfies SocketMeta);

    await this.handleJoin(pid, name);
    // Send initial state to the newcomer.
    this.sendView(server, pid);
    this.send(server, { t: 'joined', youId: pid, roomCode: this.roomCode });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- Connection lifecycle ----------------------------------------------

  private async handleJoin(pid: string, name: string): Promise<void> {
    const existing = this.game.players.find((p) => p.id === pid);
    if (existing) {
      existing.connected = true;
      if (name && existing.name !== name && this.game.phase === 'lobby') existing.name = name;
    } else if (this.game.phase === 'lobby') {
      const r = addPlayer(this.game, pid, name);
      if (r.ok) this.game = r.state;
    }
    await this.persist();
    this.broadcastViews();
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.load();
    if (typeof raw !== 'string') return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    const meta = ws.deserializeAttachment() as SocketMeta | null;
    if (!meta) return;
    await this.dispatch(ws, meta.playerId, msg);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.load();
    const meta = ws.deserializeAttachment() as SocketMeta | null;
    if (!meta) return;
    const player = this.game.players.find((p) => p.id === meta.playerId);
    if (player) {
      player.connected = false;
      // In the lobby, drop the player entirely.
      if (this.game.phase === 'lobby') {
        this.game.players = this.game.players.filter((p) => p.id !== meta.playerId);
        if (this.game.hostId === meta.playerId) {
          this.game.hostId = this.game.players[0]?.id ?? '';
        }
      }
      await this.persist();
      this.broadcastViews();
    }
  }

  // ---- Message dispatch ----------------------------------------------------

  private async dispatch(ws: WebSocket, pid: string, msg: ClientMessage): Promise<void> {
    switch (msg.t) {
      case 'join':
        await this.handleJoin(pid, msg.name);
        return;

      case 'set_ready': {
        const p = this.game.players.find((x) => x.id === pid);
        if (p && this.game.phase === 'lobby') {
          p.ready = msg.ready;
          await this.persist();
          this.broadcastViews();
        }
        return;
      }

      case 'start_game': {
        if (pid !== this.game.hostId || this.game.phase !== 'lobby') return;
        if (this.game.players.length < RULES.minPlayers) {
          this.send(ws, { t: 'error', message: 'Need at least 2 players' });
          return;
        }
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        const r = startGame(this.game, seed);
        if (!r.ok) {
          this.send(ws, { t: 'error', message: r.error });
          return;
        }
        this.game = r.state;
        await this.persist();
        this.broadcastEvents(r.events);
        this.broadcastViews();
        return;
      }

      case 'play': {
        await this.runAction(ws, {
          type: 'play',
          playerId: pid,
          cardIds: msg.cardIds,
          combo: msg.combo,
          target: msg.target,
          namedCard: msg.namedCard,
          discardCardId: msg.discardCardId,
        });
        // Open / skip the Nope window depending on whether anyone can Nope.
        await this.maybeOpenNopeWindow();
        return;
      }

      case 'nope': {
        await this.runAction(ws, { type: 'nope', playerId: pid, cardId: msg.cardId });
        // Reset the window on each Nope so others can respond / re-Nope.
        await this.maybeOpenNopeWindow();
        return;
      }

      case 'draw':
        await this.runAction(ws, { type: 'draw', playerId: pid });
        return;

      case 'defuse':
        await this.runAction(ws, {
          type: 'defuse',
          playerId: pid,
          cardId: msg.cardId,
          insertPosition: msg.insertPosition,
        });
        return;

      case 'give_favor_card':
        await this.runAction(ws, { type: 'give_favor_card', playerId: pid, cardId: msg.cardId });
        return;

      case 'leave': {
        this.game.players = this.game.players.filter((p) => p.id !== pid);
        await this.persist();
        this.broadcastViews();
        return;
      }
    }
  }

  private async runAction(ws: WebSocket, action: Parameters<typeof applyAction>[1]): Promise<void> {
    const r = applyAction(this.game, action);
    if (!r.ok) {
      this.send(ws, { t: 'error', message: r.error });
      return;
    }
    this.game = r.state;
    this.reshuffleIfNeeded(r.events);
    await this.persist();
    this.broadcastEvents(r.events);
    this.broadcastViews();
  }

  /**
   * After the engine resolves a Shuffle, replace the draw-pile order with a
   * crypto-seeded shuffle so the order stays genuinely unpredictable (the
   * engine's pure shuffle is deterministic from public state).
   */
  private reshuffleIfNeeded(events: GameEvent[]): void {
    if (events.some((e) => e.type === 'shuffled')) {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      this.game = { ...this.game, drawPile: shuffle(this.game.drawPile, createRng(seed)) };
    }
  }

  // ---- Nope window via alarm ----------------------------------------------

  private async maybeOpenNopeWindow(): Promise<void> {
    if (!this.game.pending) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete('nopeDeadline');
      return;
    }
    // Does any *other* alive player hold a Nope? If not, resolve immediately.
    const actorId = this.game.pending.by;
    const someoneCanNope = this.game.players.some(
      (p) => p.alive && p.id !== actorId && p.connected && p.hand.some((c) => c.type === CardType.Nope),
    );
    if (!someoneCanNope) {
      await this.resolveNow();
      return;
    }
    const deadline = Date.now() + RULES.nopeWindowMs;
    await this.ctx.storage.put('nopeDeadline', deadline);
    await this.ctx.storage.setAlarm(deadline);
    this.broadcastViews(deadline);
  }

  private async resolveNow(): Promise<void> {
    const r = applyAction(this.game, { type: 'resolve_pending' });
    if (r.ok) {
      this.game = r.state;
      this.reshuffleIfNeeded(r.events);
      await this.ctx.storage.delete('nopeDeadline');
      await this.ctx.storage.deleteAlarm();
      await this.persist();
      this.broadcastEvents(r.events);
      this.broadcastViews();
    }
  }

  async alarm(): Promise<void> {
    await this.load();
    if (this.game.pending) await this.resolveNow();
  }

  // ---- Broadcasting --------------------------------------------------------

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets();
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }

  private sendView(ws: WebSocket, pid: string, deadline: number | null = null): void {
    this.send(ws, { t: 'view', view: projectView(this.game, this.roomCode, pid, deadline) });
  }

  private broadcastViews(deadline: number | null = null): void {
    for (const ws of this.sockets()) {
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (meta) this.sendView(ws, meta.playerId, deadline);
    }
  }

  /**
   * Broadcast events to all players, but route See the Future privately to the
   * viewing player only (it reveals hidden deck information).
   */
  private broadcastEvents(events: GameEvent[]): void {
    const publicEvents = events.filter((e) => e.type !== 'see_future');
    for (const ws of this.sockets()) {
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (!meta) continue;
      if (publicEvents.length) this.send(ws, { t: 'events', events: publicEvents });
      for (const e of events) {
        if (e.type === 'see_future' && e.by === meta.playerId) {
          this.send(ws, { t: 'see_future', cards: e.cards });
        }
      }
    }
  }
}
