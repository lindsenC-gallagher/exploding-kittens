import {
  addBot,
  addPlayer,
  applyAction,
  botThinkMs,
  canRespondToPending,
  createLobby,
  decideBotMove,
  isAvatar,
  pickAvatar,
  parseClientMessage,
  projectSpectatorView,
  projectView,
  projectWaitingView,
  redactEventForRecipient,
  removeBot,
  reorderHand,
  resetToLobby,
  setOptions,
  shouldSpectate,
  startGame,
  RULES,
  CardType,
  type ClientMessage,
  type GameAction,
  type SpectatorReason,
  type GameEvent,
  type GameState,
  type PlayerState,
  type ServerMessage,
} from '@ek/shared';
import type { Env } from './index.js';

interface SocketMeta {
  playerId: string;
  /** True for a read-only watcher (not a seated player). */
  spectator?: boolean;
  /** Why this watcher is spectating (drives the on-screen banner). */
  spectatorReason?: SpectatorReason;
  /**
   * True for someone who reached a room mid-game without a seat. Unlike a
   * spectator they receive NO hidden info — just a holding screen — and are
   * seated automatically when the host starts the next game.
   */
  waiting?: boolean;
}

/** A scheduled timer's purpose, so the alarm knows what to do when it fires. */
type TimerKind = 'nope' | 'awaiting' | 'turn' | 'bot';

/** Random in [0, 1) from crypto entropy, for bot decisions made in the room. */
function botRand(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
}

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
  /**
   * People who arrived mid-game without a seat: playerId -> chosen name. They
   * watch a holding screen (no hidden info) and are dealt into the next game the
   * host starts, capacity permitting. Persisted so a reconnect keeps its place.
   */
  private waiting: Record<string, string> = {};
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
    this.waiting = (await this.ctx.storage.get<Record<string, string>>('waiting')) ?? {};
    const kind = await this.ctx.storage.get<TimerKind>('timerKind');
    this.nopeDeadline = kind === 'nope' ? ((await this.ctx.storage.get<number>('timerDeadline')) ?? null) : null;
    this.stealPickableAt = (await this.ctx.storage.get<number>('stealPickableAt')) ?? null;
    this.loaded = true;
    // Re-arm a timer if a timed state survived hibernation without a live alarm.
    // The bot check covers a bot whose plain turn is up (no pending/awaiting),
    // which the other conditions wouldn't catch.
    if (
      this.game.pending ||
      this.game.awaiting ||
      this.disconnectedCurrentPlayer() ||
      (this.hasBots() && this.hasConnectedHuman())
    ) {
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

    // The explicit "watch" link is honored only in the lobby, where there is no
    // hidden information to leak (hands are empty, the deck isn't dealt). Once a
    // game is underway, only players who were dealt in may see the reveal, so a
    // mid-game watch link falls through to the waiting path below instead.
    if (spectate && this.game.phase === 'lobby' && !this.tokens[pid]) {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({
        playerId: pid,
        spectator: true,
        spectatorReason: 'watching',
      } satisfies SocketMeta);
      this.sendView(pair[1]);
      this.send(pair[1], { t: 'joined', youId: pid, roomCode: this.roomCode, token: '' });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Only people who were dealt into the current game may watch the unredacted
    // reveal: an eliminated seated player still holds a token, so they fall
    // through to the seat path below and `sendView` hands them the spectator
    // reveal via `shouldSpectate`. A newcomer (no token, not seated, and the
    // lobby isn't open to them) must NOT see hidden info. They're parked on a
    // holding screen and seated when the host starts the next game. This also
    // covers an explicit ?spectate=1 link from a non-player: honoring it would
    // re-expose every hand mid-game, so we route it to the waiting screen too.
    if (!this.tokens[pid]) {
      const isPlayer = this.game.players.some((p) => p.id === pid);
      const lobbyHasRoom =
        this.game.phase === 'lobby' && this.game.players.length < RULES.maxPlayers;
      if (!isPlayer && !lobbyHasRoom) {
        // Remember their name so the next game deals them in with it.
        if (this.waiting[pid] !== name) {
          this.waiting[pid] = name;
          await this.ctx.storage.put('waiting', this.waiting);
        }
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment({ playerId: pid, waiting: true } satisfies SocketMeta);
        this.sendView(pair[1]);
        this.send(pair[1], { t: 'joined', youId: pid, roomCode: this.roomCode, token: '' });
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
    }

    // Authenticate the seat. The first connection for a pid mints a secret token;
    // every later connection MUST present it — there is no token-less "reclaim".
    // A legitimate client that loses its token also loses its pid (both live in
    // localStorage), so only an impersonator would arrive with a known pid and no
    // token. New seats are handed out only for an open lobby. A seat-less
    // connection to an in-progress room has already been diverted to waiting
    // above, so the guard below is a defensive backstop (the token map still
    // can't grow past the lobby cap).
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

  /**
   * Deal anyone who was waiting (parked while a game was in progress) into the
   * now-open lobby, up to the table cap. Each promoted player gets a real seat,
   * a freshly minted token, and their socket is upgraded from a read-only
   * waiting socket to a normal seated one. Anyone who doesn't fit stays waiting.
   * Call only when the game is back in the lobby.
   */
  private async seatWaitingPlayers(): Promise<void> {
    const waiters = Object.entries(this.waiting);
    if (waiters.length === 0) return;
    let tokensChanged = false;
    for (const [pid, name] of waiters) {
      if (this.game.players.length >= RULES.maxPlayers) break; // table full — keep waiting
      const taken = this.game.players.map((p) => p.avatar);
      const avatar = pickAvatar(taken, (max) => cryptoSeed() % max);
      const r = addPlayer(this.game, pid, name, avatar);
      if (!r.ok) continue;
      this.game = r.state;
      // Mint the seat token and release the waiting slot.
      const issued = crypto.randomUUID();
      this.tokens[pid] = issued;
      delete this.waiting[pid];
      tokensChanged = true;
      // Upgrade this player's waiting socket(s) to seated, and hand them the
      // token they now need to reconnect with.
      for (const ws of this.sockets()) {
        const meta = ws.deserializeAttachment() as SocketMeta | null;
        if (meta?.playerId !== pid) continue;
        ws.serializeAttachment({ playerId: pid } satisfies SocketMeta);
        this.send(ws, { t: 'joined', youId: pid, roomCode: this.roomCode, token: issued });
      }
    }
    if (tokensChanged) {
      await this.ctx.storage.put('tokens', this.tokens);
      await this.ctx.storage.put('waiting', this.waiting);
      await this.persist();
    }
  }

  /**
   * Convert seatless lobby watchers into waiting newcomers when a game starts.
   * A lobby watcher saw no hidden info; once the deal happens they must not get
   * the unredacted reveal, so we re-flag their socket as waiting and register
   * them so the next game seats them. Seated players (who hold a token) are
   * untouched — an eliminated one still earns the reveal via `shouldSpectate`.
   */
  private async parkSpectatorsForInProgress(): Promise<void> {
    let changed = false;
    for (const ws of this.sockets()) {
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (!meta?.spectator) continue;
      if (this.tokens[meta.playerId]) continue; // a seated player's reveal, leave it
      ws.serializeAttachment({ playerId: meta.playerId, waiting: true } satisfies SocketMeta);
      if (this.waiting[meta.playerId] === undefined) {
        this.waiting[meta.playerId] = 'Player';
        changed = true;
      }
    }
    if (changed) await this.ctx.storage.put('waiting', this.waiting);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.load();
    if (typeof raw !== 'string') return;
    if (!this.allowMessage(ws)) return; // per-socket rate limit (drop floods)
    const msg = parseClientMessage(raw);
    if (!msg) return; // malformed / unknown frame — ignore rather than crash
    const meta = ws.deserializeAttachment() as SocketMeta | null;
    if (!meta) return;
    if (meta.spectator || meta.waiting) return; // read-only; never mutates the game
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
    // A waiting newcomer who leaves before the next game gives up their place —
    // release the waiting slot so the map can't grow without bound.
    if (meta.waiting) {
      if (this.waiting[meta.playerId] !== undefined) {
        delete this.waiting[meta.playerId];
        await this.ctx.storage.put('waiting', this.waiting);
      }
      return;
    }
    await this.markDisconnected(meta.playerId);
  }

  private async markDisconnected(pid: string): Promise<void> {
    const player = this.game.players.find((p) => p.id === pid);
    if (!player) return;
    player.connected = false;
    if (this.game.phase === 'lobby') {
      // In the lobby, drop the player entirely and reassign host if needed. A bot
      // can never be host (it can't press Start), so hand it to another human.
      this.game.players = this.game.players.filter((p) => p.id !== pid);
      if (this.game.hostId === pid) {
        const nextHost = this.game.players.find((p) => !p.isBot) ?? this.game.players[0];
        this.game.hostId = nextHost?.id ?? '';
      }
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

      case 'add_bot': {
        // Only the host, only in the lobby. The bot's id is minted server-side so
        // a client can never forge one or impersonate a bot's seat.
        if (pid !== this.game.hostId || this.game.phase !== 'lobby') return;
        const r = addBot(this.game, `bot:${crypto.randomUUID()}`, msg.difficulty);
        if (!r.ok) {
          this.send(ws, { t: 'error', message: r.error });
          return;
        }
        this.game = r.state;
        await this.persist();
        this.broadcastViews();
        return;
      }

      case 'remove_bot': {
        if (pid !== this.game.hostId || this.game.phase !== 'lobby') return;
        this.game = removeBot(this.game, msg.botId);
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
        // A lobby watcher must not see the in-progress reveal: now that the deal
        // has happened, downgrade any seatless spectator to a waiting newcomer so
        // they get the holding screen and join the next game, not this one.
        await this.parkSpectatorsForInProgress();
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
        // Now that there's an open lobby, deal in anyone who was waiting (up to
        // the table cap). They become normal seated players for the next game.
        await this.seatWaitingPlayers();
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

  // ---- Bots ----------------------------------------------------------------

  /** Any human still watching/playing? Bots only act while someone's here to see it. */
  private hasConnectedHuman(): boolean {
    return this.game.players.some((p) => !p.isBot && p.connected);
  }

  private hasBots(): boolean {
    return this.game.players.some((p) => p.isBot);
  }

  /**
   * The move a bot should make right now, computed from the SAME redacted view a
   * human gets (so a bot can never see hidden cards). Scans bots in seat order
   * and returns the first that has something to do — its own turn, a forced
   * choice aimed at it, or a Nope it wants to throw — or null if no bot should
   * act. Cheap and bounded by the (small) number of bots.
   */
  private findBotMove(): { bot: PlayerState; action: GameAction } | null {
    if (this.game.phase !== 'playing') return null;
    for (const bot of this.game.players) {
      if (!bot.isBot || !bot.alive) continue;
      const view = projectView(this.game, this.roomCode, bot.id, this.nopeDeadline, this.stealPickableAt);
      const msg = decideBotMove(view, bot.botDifficulty ?? 'medium', botRand);
      if (!msg) continue;
      const action = this.clientMsgToAction(bot.id, msg);
      if (action) return { bot, action };
    }
    return null;
  }

  /** Translate a bot's client message into an engine action (same shape humans use). */
  private clientMsgToAction(pid: string, msg: ClientMessage): GameAction | null {
    switch (msg.t) {
      case 'play':
        return {
          type: 'play',
          playerId: pid,
          cardIds: msg.cardIds,
          combo: msg.combo,
          target: msg.target,
          namedCard: msg.namedCard,
          discardCardId: msg.discardCardId,
        };
      case 'nope':
        return { type: 'nope', playerId: pid, cardId: msg.cardId };
      case 'draw':
        return { type: 'draw', playerId: pid };
      case 'defuse':
        return { type: 'defuse', playerId: pid, cardId: msg.cardId, insertPosition: msg.insertPosition };
      case 'give_favor_card':
        return { type: 'give_favor_card', playerId: pid, cardId: msg.cardId };
      case 'steal_pick':
        return { type: 'steal_pick', playerId: pid, cardIndex: msg.cardIndex };
      default:
        return null;
    }
  }

  /**
   * Run a bot's chosen move, with a fail-safe: if the engine rejects it (which
   * shouldn't happen, the bot plays by the rules) we fall back to a guaranteed
   * legal action so a bot can never wedge the table into a no-progress loop.
   */
  private async runBotMove(move: { bot: PlayerState; action: GameAction }): Promise<void> {
    const applied = await this.runAction(null, move.action);
    if (applied) return;
    if (this.game.pending) {
      await this.resolvePendingNow();
    } else if (this.game.awaiting) {
      await this.autoResolveAwaiting();
    } else {
      const cur = this.game.players[this.game.currentPlayerIndex];
      if (cur?.id === move.bot.id && this.game.drawPile.length > 0) {
        await this.runAction(null, { type: 'draw', playerId: move.bot.id });
      }
    }
  }

  // ---- Timers (single alarm for Nope window / awaiting / turn / bot) --------

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

    // Bots only take their turns while a human is connected to watch — this stops
    // a room of bots from playing on forever to an empty table.
    const botsActive = this.hasBots() && this.hasConnectedHuman();
    const botMove = botsActive ? this.findBotMove() : null;
    const botAt = (p: PlayerState) => Date.now() + botThinkMs(p.botDifficulty ?? 'medium', botRand);

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
      this.nopeDeadline = deadline;
      // A bot that wants to Nope acts partway through the window; otherwise the
      // window just runs to its deadline and resolves.
      if (botMove && botMove.action.type === 'nope') {
        await this.armAlarm('bot', Math.min(deadline, botAt(botMove.bot)));
      } else {
        await this.armAlarm('nope', deadline);
      }
      return;
    }

    await this.ctx.storage.delete('nopeStart');
    this.nopeDeadline = null;

    if (this.game.awaiting) {
      // If a bot owes the forced choice, drive it after a short think (a steal
      // pick also waits out the victim's rearrange grace); otherwise fall back to
      // the human auto-resolve timer.
      const actor = botsActive ? this.game.players.find((p) => p.id === this.game.awaiting!.playerId) : undefined;
      if (actor?.isBot) {
        let at = botAt(actor);
        if (this.game.awaiting.type === 'steal_pick' && this.stealPickableAt !== null) {
          at = Math.max(at, this.stealPickableAt + 50);
        }
        await this.armAlarm('bot', at);
        return;
      }
      await this.armAlarm('awaiting', Date.now() + RULES.awaitingTimeoutMs);
      return;
    }
    if (this.disconnectedCurrentPlayer()) {
      await this.armAlarm('turn', Date.now() + RULES.turnTimeoutMs);
      return;
    }
    // The current player is a bot: take its turn after a short think.
    if (botMove) {
      await this.armAlarm('bot', botAt(botMove.bot));
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
    const botsActive = this.hasBots() && this.hasConnectedHuman();
    const botMove = botsActive ? this.findBotMove() : null;
    if (this.game.pending) {
      // A bot Nope was scheduled inside the window; play it. Otherwise the window
      // has reached its deadline — resolve the pending action.
      if (botMove && botMove.action.type === 'nope') await this.runBotMove(botMove);
      else await this.resolvePendingNow();
    } else if (this.game.awaiting) {
      // The awaiting seat may be a bot (drive it) or a human who timed out.
      if (botMove) await this.runBotMove(botMove);
      else await this.autoResolveAwaiting();
    } else if (this.disconnectedCurrentPlayer()) {
      await this.autoAdvanceTurn();
    } else if (botMove) {
      await this.runBotMove(botMove);
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
    // Someone waiting to join an in-progress game gets a holding view with NO
    // hidden info (no other hands, no deck order) until the next game seats them.
    if (meta.waiting) {
      this.send(ws, {
        t: 'view',
        view: projectWaitingView(this.game, this.roomCode, this.nopeDeadline, this.stealPickableAt),
      });
      return;
    }
    // Read-only watchers, and seated players who've been eliminated mid-game,
    // both get the unredacted spectator projection (all hands + the deck), tagged
    // with why they're watching so the UI can explain it.
    const reason: SpectatorReason | null = meta.spectator
      ? (meta.spectatorReason ?? 'watching')
      : shouldSpectate(this.game, meta.playerId)
        ? 'eliminated'
        : null;
    const view = reason
      ? projectSpectatorView(
          this.game,
          this.roomCode,
          this.nopeDeadline,
          this.stealPickableAt,
          reason,
          // Read-only watchers stay seatless; an eliminated player keeps their id
          // so the view knows who they are (e.g. a knocked-out host can restart).
          meta.spectator ? '' : meta.playerId,
        )
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
