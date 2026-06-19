import {
  addPlayer,
  applyAction,
  canRespondToPending,
  createLobby,
  isAvatar,
  pickAvatar,
  parseClientMessage,
  projectSpectatorView,
  projectView,
  redactEventForRecipient,
  reorderHand,
  resetToLobby,
  setOptions,
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
  /** True for a read-only watcher (not a seated player). */
  spectator?: boolean;
}

/** A scheduled timer's purpose, so the alarm knows what to do when it fires. */
type TimerKind = 'nope' | 'awaiting' | 'turn';

function cryptoSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** Max client frames accepted per socket per second; excess is dropped. */
const MAX_MESSAGES_PER_SECOND = 30;

function clampName(name: unknown): string {
  // Strip control characters, then trim and cap length. Defense-in-depth for
  // display names (the React client also escapes on render).
  const raw = typeof name === 'string' ? name : '';
  let cleaned = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) cleaned += ch;
  }
  cleaned = cleaned.trim().slice(0, 20);
  return cleaned || 'Player';
}

/**
 * One Durable Object instance per room code. Holds the authoritative GameState,
 * owns every connected WebSocket, runs the engine, and broadcasts redacted
 * per-player views.
 *
 * A single DO alarm serves three mutually-exclusive timed states: the Nope
 * window, an unanswered forced choice (Favor/Defuse), and a disconnected
 * current player's turn. The alarm is re-armed on load so it survives hibernation.
 */
export class GameRoom {
  private ctx: DurableObjectState;
  private game!: GameState;
  private roomCode = '';
  /** Per-seat secret tokens: playerId -> token. Authenticates reconnects. */
  private tokens: Record<string, string> = {};
  private loaded = false;
  /** Current Nope-window deadline (epoch ms) for the client countdown, or null. */
  private nopeDeadline: number | null = null;
  /**
   * Epoch ms before which the thief may not pick during a blind steal — the
   * victim's grace window to rearrange. Null when no steal is in progress.
   */
  private stealPickableAt: number | null = null;
  /**
   * Epoch ms of the last applied Nope. Used for a brief cooldown so two players
   * Noping at the same instant don't accidentally stack into a Yup. Reset when a
   * fresh action opens its Nope window.
   */
  private lastNopeAt: number | null = null;
  /** Per-socket fixed-window message counters for rate limiting. */
  private msgWindows = new WeakMap<WebSocket, { count: number; start: number }>();

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.game = (await this.ctx.storage.get<GameState>('game')) ?? createLobby('');
    this.roomCode = (await this.ctx.storage.get<string>('code')) ?? '';
    this.tokens = (await this.ctx.storage.get<Record<string, string>>('tokens')) ?? {};
    const kind = await this.ctx.storage.get<TimerKind>('timerKind');
    this.nopeDeadline = kind === 'nope' ? ((await this.ctx.storage.get<number>('timerDeadline')) ?? null) : null;
    this.stealPickableAt = (await this.ctx.storage.get<number>('stealPickableAt')) ?? null;
    this.loaded = true;
    // Re-arm a timer if a timed state survived hibernation without a live alarm.
    if (this.game.pending || this.game.awaiting || this.disconnectedCurrentPlayer()) {
      await this.settle();
    }
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('game', this.game);
  }

  // ---- HTTP / WebSocket upgrade -------------------------------------------

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
    const token = url.searchParams.get('token') ?? '';
    const name = clampName(url.searchParams.get('name'));
    const spectate = url.searchParams.get('spectate') === '1';
    if (!pid || pid.length > 64) return new Response('Missing pid', { status: 400 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    // Spectators are read-only watchers: no seat, no token, no player record.
    // They may watch at any time (lobby or in-progress) and never affect the game.
    if (spectate) {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ playerId: pid, spectator: true } satisfies SocketMeta);
      this.sendView(pair[1]);
      this.send(pair[1], { t: 'joined', youId: pid, roomCode: this.roomCode, token: '' });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Authenticate the seat. The first connection for a pid mints a secret token;
    // every later connection MUST present it — there is no token-less "reclaim".
    // A legitimate client that loses its token also loses its pid (both live in
    // localStorage), so only an impersonator would arrive with a known pid and no
    // token. New seats are handed out only for an open lobby, so connections that
    // are neither a known seat nor an eligible new player are refused (no snooping
    // on in-progress rooms, and the token map can't grow past the lobby cap).
    const existing = this.tokens[pid];
    let issuedToken: string;
    if (existing) {
      if (token !== existing) return new Response('Seat in use', { status: 403 });
      issuedToken = existing;
    } else {
      const isPlayer = this.game.players.some((p) => p.id === pid);
      const lobbyHasRoom =
        this.game.phase === 'lobby' && this.game.players.length < RULES.maxPlayers;
      if (!isPlayer && !lobbyHasRoom) return new Response('Room unavailable', { status: 403 });
      issuedToken = crypto.randomUUID();
      this.tokens[pid] = issuedToken;
      await this.ctx.storage.put('tokens', this.tokens);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: pid } satisfies SocketMeta);

    await this.handleJoin(pid, name);
    this.sendView(server);
    this.send(server, { t: 'joined', youId: pid, roomCode: this.roomCode, token: issuedToken });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- Connection lifecycle ----------------------------------------------

  private async handleJoin(pid: string, name: string): Promise<void> {
    const existing = this.game.players.find((p) => p.id === pid);
    if (existing) {
      existing.connected = true;
      if (name && existing.name !== name && this.game.phase === 'lobby') existing.name = name;
    } else if (this.game.phase === 'lobby') {
      // Give the new seat a random avatar, preferring ones nobody has yet.
      const taken = this.game.players.map((p) => p.avatar);
      const avatar = pickAvatar(taken, (max) => cryptoSeed() % max);
      const r = addPlayer(this.game, pid, name, avatar);
      if (r.ok) this.game = r.state;
    }
    await this.persist();
    await this.settle();
    this.broadcastViews();
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.load();
    if (typeof raw !== 'string') return;
    if (!this.allowMessage(ws)) return; // per-socket rate limit (drop floods)
    const msg = parseClientMessage(raw);
    if (!msg) return; // malformed / unknown frame — ignore rather than crash
    const meta = ws.deserializeAttachment() as SocketMeta | null;
    if (!meta) return;
    if (meta.spectator) return; // read-only watcher; never mutates the game
    await this.dispatch(ws, meta.playerId, msg);
  }

  /** Fixed-window per-socket rate limit; drops frames above the cap. */
  private allowMessage(ws: WebSocket): boolean {
    const now = Date.now();
    const w = this.msgWindows.get(ws);
    if (!w || now - w.start >= 1000) {
      this.msgWindows.set(ws, { count: 1, start: now });
      return true;
    }
    w.count += 1;
    return w.count <= MAX_MESSAGES_PER_SECOND;
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.load();
    const meta = ws.deserializeAttachment() as SocketMeta | null;
    if (!meta) return;
    // If the player still has another live socket (e.g. a second tab), do nothing.
    if (this.hasLiveSocket(meta.playerId, ws)) return;
    await this.markDisconnected(meta.playerId);
  }

  private async markDisconnected(pid: string): Promise<void> {
    const player = this.game.players.find((p) => p.id === pid);
    if (!player) return;
    player.connected = false;
    if (this.game.phase === 'lobby') {
      // In the lobby, drop the player entirely and reassign host if needed.
      this.game.players = this.game.players.filter((p) => p.id !== pid);
      if (this.game.hostId === pid) this.game.hostId = this.game.players[0]?.id ?? '';
      // Release the seat token too; otherwise lobby join/leave churn grows the
      // persisted token map without bound (a fresh pid needs no token to join).
      if (this.tokens[pid]) {
        delete this.tokens[pid];
        await this.ctx.storage.put('tokens', this.tokens);
      }
    }
    await this.persist();
    await this.settle();
    this.broadcastViews();
  }

  // ---- Message dispatch ----------------------------------------------------

  private async dispatch(ws: WebSocket, pid: string, msg: ClientMessage): Promise<void> {
    switch (msg.t) {
      case 'join':
        await this.handleJoin(pid, clampName(msg.name));
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

      case 'set_name': {
        // Lobby-only: a player renames their own seat. Same clamp as join.
        const p = this.game.players.find((x) => x.id === pid);
        if (p && this.game.phase === 'lobby') {
          const name = clampName(msg.name);
          if (p.name !== name) {
            p.name = name;
            await this.persist();
            this.broadcastViews();
          }
        }
        return;
      }

      case 'set_avatar': {
        // Purely cosmetic; allowed any time. Validation already confirmed the
        // avatar is one of the allowed set.
        const p = this.game.players.find((x) => x.id === pid);
        if (p && isAvatar(msg.avatar) && p.avatar !== msg.avatar) {
          p.avatar = msg.avatar;
          await this.persist();
          this.broadcastViews();
        }
        return;
      }

      case 'set_options': {
        // House rules are the host's call and only adjustable before kick-off.
        if (pid !== this.game.hostId || this.game.phase !== 'lobby') return;
        this.game = setOptions(this.game, msg.options);
        await this.persist();
        this.broadcastViews();
        return;
      }

      case 'start_game': {
        if (pid !== this.game.hostId || this.game.phase !== 'lobby') return;
        if (this.game.players.length < RULES.minPlayers) {
          this.send(ws, { t: 'error', message: 'Need at least 2 players' });
          return;
        }
        const r = startGame(this.game, cryptoSeed());
        if (!r.ok) {
          this.send(ws, { t: 'error', message: r.error });
          return;
        }
        this.game = r.state;
        await this.persist();
        this.broadcastEvents(r.events);
        await this.settle();
        this.broadcastViews();
        return;
      }

      case 'play_again': {
        // Host-only, after a game ends: return everyone to this room's lobby so
        // the same group can play again without making a new room.
        if (pid !== this.game.hostId || this.game.phase !== 'gameOver') return;
        this.game = resetToLobby(this.game);
        await this.persist();
        this.broadcastViews();
        return;
      }

      case 'play':
        await this.runAction(ws, {
          type: 'play',
          playerId: pid,
          cardIds: msg.cardIds,
          combo: msg.combo,
          target: msg.target,
          namedCard: msg.namedCard,
          discardCardId: msg.discardCardId,
        });
        return;

      case 'nope': {
        // Pause: ignore a Nope that lands within nopeCooldownMs of the last one,
        // so two players tapping at once don't stack into an accidental Yup.
        if (this.lastNopeAt !== null && Date.now() - this.lastNopeAt < RULES.nopeCooldownMs) {
          return;
        }
        const applied = await this.runAction(ws, { type: 'nope', playerId: pid, cardId: msg.cardId });
        if (applied) this.lastNopeAt = Date.now();
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

      case 'steal_pick':
        // Hold the thief off until the victim's rearrange window has elapsed.
        if (
          this.game.awaiting?.type === 'steal_pick' &&
          this.stealPickableAt !== null &&
          Date.now() < this.stealPickableAt
        ) {
          this.send(ws, { t: 'error', message: 'Wait — they are still rearranging their hand' });
          return;
        }
        await this.runAction(ws, { type: 'steal_pick', playerId: pid, cardIndex: msg.cardIndex });
        return;

      case 'reorder_hand': {
        // Once a blind steal's grace window has elapsed, the victim's hand is
        // locked — they can no longer shuffle it to dodge the thief's pick.
        if (
          this.game.awaiting?.type === 'steal_pick' &&
          this.game.awaiting.fromPlayerId === pid &&
          this.stealPickableAt !== null &&
          Date.now() >= this.stealPickableAt
        ) {
          // Re-send the authoritative order so the client snaps back.
          this.sendView(ws);
          return;
        }
        // A private, cosmetic rearrange: it touches only this player's hand
        // order (no version bump, no events, no timers). Applied outside the
        // action pipeline so it can't reset the Nope window or churn versions.
        const next = reorderHand(this.game, pid, msg.order);
        if (!next) return; // not a valid permutation — ignore
        this.game = next;
        await this.persist();
        // Order is private, so only this player's own sockets need the update.
        for (const s of this.sockets()) {
          const meta = s.deserializeAttachment() as SocketMeta | null;
          if (meta?.playerId === pid && !meta.spectator) this.sendView(s);
        }
        return;
      }

      case 'leave': {
        // Never mutate players mid-game (it would corrupt turn order / deck math).
        // Treat an in-game leave as a disconnect; only remove in the lobby.
        await this.markDisconnected(pid);
        return;
      }
    }
  }

  /**
   * Apply an engine action from a client, then broadcast and (re)settle timers.
   * Returns true if the action was applied (false if it was illegal/invalid).
   */
  private async runAction(
    ws: WebSocket | null,
    action: Parameters<typeof applyAction>[1],
  ): Promise<boolean> {
    let r: ReturnType<typeof applyAction>;
    try {
      r = applyAction(this.game, action, { rngSeed: cryptoSeed() });
    } catch {
      // A malformed action must never tear down the room; treat it as illegal.
      if (ws) this.send(ws, { t: 'error', message: 'Invalid action' });
      return false;
    }
    if (!r.ok) {
      if (ws) this.send(ws, { t: 'error', message: r.error });
      return false;
    }
    // A freshly played action opens a new Nope window — clear the prior cooldown.
    if (action.type === 'play') this.lastNopeAt = null;
    this.game = r.state;
    await this.persist();
    this.broadcastEvents(r.events);
    await this.settle();
    this.broadcastViews();
    return true;
  }

  // ---- Timers (single alarm for Nope window / awaiting / turn) -------------

  private disconnectedCurrentPlayer(): boolean {
    if (this.game.phase !== 'playing' || this.game.pending || this.game.awaiting) return false;
    const cur = this.game.players[this.game.currentPlayerIndex];
    return !!cur && cur.alive && !cur.connected;
  }

  /**
   * Decide what, if anything, needs a timer given the current state, and arm the
   * single DO alarm accordingly. Resolves a Nope window immediately when nobody
   * can Nope (recursing, since resolution may open a new timed state).
   */
  private async settle(): Promise<void> {
    // Open / close the blind-steal grace window. While a steal_pick is awaiting,
    // the victim gets `stealShuffleMs` to rearrange before the thief may pick.
    if (this.game.awaiting?.type === 'steal_pick') {
      if (this.stealPickableAt === null) {
        this.stealPickableAt = Date.now() + RULES.stealShuffleMs;
        await this.ctx.storage.put('stealPickableAt', this.stealPickableAt);
      }
    } else if (this.stealPickableAt !== null) {
      this.stealPickableAt = null;
      await this.ctx.storage.delete('stealPickableAt');
    }

    if (this.game.pending) {
      // Keep the Nope window open while anyone may still respond — including the
      // actor, who may play a Nope as a "Yup" when their action is currently
      // cancelled (an odd Nope count). Resolve immediately only when nobody can.
      if (!canRespondToPending(this.game)) {
        await this.resolvePendingNow();
        return;
      }
      // Cap the total window so repeated Nopes can't stall the game forever.
      const start = (await this.ctx.storage.get<number>('nopeStart')) ?? Date.now();
      await this.ctx.storage.put('nopeStart', start);
      const deadline = Math.min(Date.now() + RULES.nopeWindowMs, start + RULES.maxNopeWindowMs);
      await this.armAlarm('nope', deadline);
      this.nopeDeadline = deadline;
      return;
    }

    await this.ctx.storage.delete('nopeStart');
    this.nopeDeadline = null;

    if (this.game.awaiting) {
      await this.armAlarm('awaiting', Date.now() + RULES.awaitingTimeoutMs);
      return;
    }
    if (this.disconnectedCurrentPlayer()) {
      await this.armAlarm('turn', Date.now() + RULES.turnTimeoutMs);
      return;
    }
    await this.clearAlarm();
  }

  private async armAlarm(kind: TimerKind, deadline: number): Promise<void> {
    await this.ctx.storage.put('timerKind', kind);
    await this.ctx.storage.put('timerDeadline', deadline);
    await this.ctx.storage.setAlarm(deadline);
  }

  private async clearAlarm(): Promise<void> {
    await this.ctx.storage.delete('timerKind');
    await this.ctx.storage.delete('timerDeadline');
    await this.ctx.storage.deleteAlarm();
  }

  private async resolvePendingNow(): Promise<void> {
    const r = applyAction(this.game, { type: 'resolve_pending' }, { rngSeed: cryptoSeed() });
    if (!r.ok) return;
    this.game = r.state;
    await this.ctx.storage.delete('nopeStart');
    await this.persist();
    this.broadcastEvents(r.events);
    await this.settle();
    this.broadcastViews();
  }

  async alarm(): Promise<void> {
    await this.load();
    if (this.game.pending) {
      await this.resolvePendingNow();
    } else if (this.game.awaiting) {
      await this.autoResolveAwaiting();
    } else if (this.disconnectedCurrentPlayer()) {
      await this.autoAdvanceTurn();
    }
  }

  /** Auto-resolve an unanswered forced choice so one player can't freeze the game. */
  private async autoResolveAwaiting(): Promise<void> {
    const awaiting = this.game.awaiting;
    if (!awaiting) return;
    const player = this.game.players.find((p) => p.id === awaiting.playerId);
    if (!player) return;

    if (awaiting.type === 'favor_give') {
      // Give a random card on the player's behalf (a card must be given).
      if (player.hand.length === 0) return;
      const idx = cryptoSeed() % player.hand.length;
      await this.runAction(null, { type: 'give_favor_card', playerId: player.id, cardId: player.hand[idx].id });
    } else if (awaiting.type === 'steal_pick') {
      // Thief never picked — take a random card on their behalf so the game
      // doesn't stall. (A pair always steals; the only "choice" is which one.)
      const target = this.game.players.find((p) => p.id === awaiting.fromPlayerId);
      const cardIndex = target && target.hand.length > 0 ? cryptoSeed() % target.hand.length : 0;
      await this.runAction(null, { type: 'steal_pick', playerId: player.id, cardIndex });
    } else {
      // defuse_or_explode: auto-play the Defuse (reinsert at a random spot) rather
      // than punishing a disconnect with elimination.
      const defuse = player.hand.find((c) => c.type === CardType.Defuse);
      if (!defuse) return;
      const pos = cryptoSeed() % (this.game.drawPile.length + 1);
      await this.runAction(null, {
        type: 'defuse',
        playerId: player.id,
        cardId: defuse.id,
        insertPosition: pos,
      });
    }
  }

  /** A disconnected current player auto-draws to end their turn (may explode). */
  private async autoAdvanceTurn(): Promise<void> {
    const cur = this.game.players[this.game.currentPlayerIndex];
    if (!cur) return;
    await this.runAction(null, { type: 'draw', playerId: cur.id });
  }

  // ---- Broadcasting --------------------------------------------------------

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets();
  }

  private hasLiveSocket(pid: string, exclude?: WebSocket): boolean {
    return this.sockets().some((ws) => {
      if (ws === exclude) return false;
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      return meta?.playerId === pid;
    });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }

  private sendView(ws: WebSocket): void {
    const meta = ws.deserializeAttachment() as SocketMeta | null;
    if (!meta) return;
    const view = meta.spectator
      ? projectSpectatorView(this.game, this.roomCode, this.nopeDeadline, this.stealPickableAt)
      : projectView(this.game, this.roomCode, meta.playerId, this.nopeDeadline, this.stealPickableAt);
    this.send(ws, { t: 'view', view });
  }

  private broadcastViews(): void {
    for (const ws of this.sockets()) {
      this.sendView(ws);
    }
  }

  /**
   * Broadcast events to all players, redacting hidden information per recipient:
   * the See the Future reveal goes only to the viewing player (as its own
   * message), and a steal's card identity is stripped for everyone but the thief
   * and the victim (see {@link redactEventForRecipient}).
   */
  private broadcastEvents(events: GameEvent[]): void {
    for (const ws of this.sockets()) {
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (!meta) continue;
      const pid = meta.playerId;
      const publicEvents = events
        .filter((e) => e.type !== 'see_future')
        .map((e) => redactEventForRecipient(e, pid));
      if (publicEvents.length) this.send(ws, { t: 'events', events: publicEvents });
      for (const e of events) {
        if (e.type === 'see_future' && e.by === pid) {
          this.send(ws, { t: 'see_future', cards: e.cards });
        }
      }
    }
  }
}
