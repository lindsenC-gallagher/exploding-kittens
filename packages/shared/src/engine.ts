import { defaultAvatarForIndex } from './avatars.js';
import {
  BASE_DECK_COMPOSITION,
  CardType,
  RULES,
  isCatCard,
  NOPEABLE_ACTIONS,
  type Card,
} from './cards.js';
import { createRng, shuffle } from './rng.js';
import {
  DEFAULT_OPTIONS,
  MAX_ATTACK_TURNS,
  MIN_ATTACK_TURNS,
  type ApplyResult,
  type ComboKind,
  type GameEvent,
  type GameOptions,
  type GameState,
  type PlayerState,
} from './state.js';

/** Engine-level actions. The server is responsible for authenticating playerId. */
export type GameAction =
  | { type: 'play'; playerId: string; cardIds: string[]; combo?: ComboKind; target?: string; namedCard?: CardType; discardCardId?: string }
  | { type: 'nope'; playerId: string; cardId: string }
  | { type: 'resolve_pending' }
  | { type: 'draw'; playerId: string }
  | { type: 'defuse'; playerId: string; cardId: string; insertPosition: number }
  | { type: 'give_favor_card'; playerId: string; cardId: string }
  | { type: 'steal_pick'; playerId: string; cardIndex: number };

let cardCounter = 0;
function makeCard(type: CardType): Card {
  cardCounter += 1;
  return { id: `c${cardCounter}`, type };
}

/**
 * Build the base deck minus Exploding Kittens and Defuse (added during setup).
 * `copies` combines that many decks — the faithful way to seat more than 5
 * players (one deck for 2-5, two for 6-9).
 */
function buildBaseDeck(copies = 1): Card[] {
  const cards: Card[] = [];
  for (let c = 0; c < copies; c++) {
    for (const [type, count] of Object.entries(BASE_DECK_COMPOSITION)) {
      if (type === CardType.ExplodingKitten || type === CardType.Defuse) continue;
      for (let i = 0; i < count; i++) cards.push(makeCard(type as CardType));
    }
  }
  return cards;
}

/** How many base decks to combine for `n` players (1 for 2-5, 2 for 6-9). */
function deckCopiesFor(n: number): number {
  return Math.ceil(n / RULES.playersPerDeck);
}

/**
 * Create the initial lobby state. Players join via {@link addPlayer}.
 */
export function createLobby(hostId: string): GameState {
  return {
    phase: 'lobby',
    hostId,
    options: { ...DEFAULT_OPTIONS },
    players: [],
    currentPlayerIndex: 0,
    turnsRemaining: 1,
    attacked: false,
    drawPile: [],
    discardPile: [],
    version: 0,
  };
}

/** Read a state's house rules, defaulting for states persisted before options existed. */
export function gameOptions(state: GameState): GameOptions {
  return state.options ?? DEFAULT_OPTIONS;
}

/**
 * Apply host-chosen house rules. Only takes effect in the lobby (options are
 * frozen once the game starts). Unknown keys are ignored by the caller's
 * validation; here we simply merge the provided booleans over the current set.
 */
export function setOptions(state: GameState, partial: Partial<GameOptions>): GameState {
  if (state.phase !== 'lobby') return state;
  const merged = { ...gameOptions(state), ...partial };
  // Keep the attack-turn cap a sane integer within bounds, whatever was sent.
  const raw = Number.isFinite(merged.maxAttackTurns) ? Math.round(merged.maxAttackTurns) : MIN_ATTACK_TURNS;
  merged.maxAttackTurns = Math.max(MIN_ATTACK_TURNS, Math.min(MAX_ATTACK_TURNS, raw));
  return {
    ...state,
    options: merged,
    version: state.version + 1,
  };
}

export function addPlayer(state: GameState, id: string, name: string): ApplyResult {
  if (state.phase !== 'lobby') return { ok: false, error: 'Game already started' };
  if (state.players.some((p) => p.id === id)) return { ok: false, error: 'Already joined' };
  if (state.players.length >= RULES.maxPlayers) return { ok: false, error: 'Lobby full' };
  const player: PlayerState = {
    id,
    name,
    avatar: defaultAvatarForIndex(state.players.length),
    hand: [],
    alive: true,
    connected: true,
    ready: false,
  };
  const players = [...state.players, player];
  const hostId = state.players.length === 0 ? id : state.hostId;
  return { ok: true, state: { ...state, players, hostId, version: state.version + 1 }, events: [] };
}

/**
 * Deal the game per the faithful base-game setup and move to the playing phase.
 * `seed` makes setup deterministic for tests; omit for a crypto-seeded server.
 */
export function startGame(state: GameState, seed: number): ApplyResult {
  if (state.phase !== 'lobby') return { ok: false, error: 'Already started' };
  const n = state.players.length;
  if (n < RULES.minPlayers) return { ok: false, error: 'Need at least 2 players' };
  if (n > RULES.maxPlayers) return { ok: false, error: 'Too many players' };

  // For 6-9 players we combine two base decks (the faithful "more than 5
  // players" rule); 2-5 players use a single deck. This is automatic, not a
  // host option.
  const copies = deckCopiesFor(n);
  const rng = createRng(seed);
  let deck = shuffle(buildBaseDeck(copies), rng);

  // Deal startingHandSize cards to each player, then give each one Defuse.
  const players = state.players.map((p) => ({ ...p, hand: [] as Card[], alive: true, ready: true }));
  for (let i = 0; i < RULES.startingHandSize; i++) {
    for (const p of players) {
      const card = deck.pop();
      if (card) p.hand.push(card);
    }
  }
  for (const p of players) p.hand.push(makeCard(CardType.Defuse));

  // Reinsert leftover Defuse cards (total Defuse across the combined decks minus
  // one per player) into the deck.
  const leftoverDefuse = Math.max(0, BASE_DECK_COMPOSITION[CardType.Defuse] * copies - n);
  for (let i = 0; i < leftoverDefuse; i++) deck.push(makeCard(CardType.Defuse));

  // Insert (players - 1) Exploding Kittens.
  for (let i = 0; i < n - 1; i++) deck.push(makeCard(CardType.ExplodingKitten));

  deck = shuffle(deck, rng);

  // Randomise the seating so turn order isn't the lobby join order. This runs on
  // every game start (a fresh shuffle per round), not once per room. Shuffled
  // after the deck so the deck composition stays identical for a given seed.
  const seated = shuffle(players, rng);

  const order = seated.map((p) => p.id);
  return {
    ok: true,
    state: {
      ...state,
      phase: 'playing',
      players: seated,
      drawPile: deck,
      discardPile: [],
      currentPlayerIndex: 0,
      turnsRemaining: 1,
      attacked: false,
      version: state.version + 1,
    },
    events: [
      { type: 'game_started', playerOrder: order },
      { type: 'turn_changed', playerId: order[0], turnsRemaining: 1 },
    ],
  };
}

/**
 * Return a finished game to the lobby, keeping the same players, host, and house
 * rules so the group can play again without making a new room. All per-game
 * state is cleared; a fresh deal happens on the next {@link startGame}. Players
 * are marked not-ready so the lobby reflects a clean pre-game state.
 */
export function resetToLobby(state: GameState): GameState {
  return {
    ...state,
    phase: 'lobby',
    players: state.players.map((p) => ({ ...p, hand: [], alive: true, ready: false })),
    currentPlayerIndex: 0,
    turnsRemaining: 1,
    attacked: false,
    drawPile: [],
    discardPile: [],
    pending: undefined,
    awaiting: undefined,
    reversibleTurnPass: undefined,
    winnerId: undefined,
    version: state.version + 1,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex];
}

function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}

/** Index of the next alive player after `fromIndex` (wrapping). */
function nextAliveIndex(state: GameState, fromIndex: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    if (state.players[idx].alive) return idx;
  }
  return fromIndex;
}

function removeCards(hand: Card[], ids: string[]): { remaining: Card[]; removed: Card[] } {
  const idSet = new Set(ids);
  const removed: Card[] = [];
  const remaining: Card[] = [];
  for (const c of hand) {
    if (idSet.has(c.id)) removed.push(c);
    else remaining.push(c);
  }
  return { remaining, removed };
}

/** Advance to the next player's turn, handling attack-driven multi-turns. */
function endTurn(state: GameState, events: GameEvent[]): void {
  if (state.turnsRemaining > 1) {
    // Same player keeps going (they owe more turns from an Attack).
    state.turnsRemaining -= 1;
    events.push({
      type: 'turn_changed',
      playerId: currentPlayer(state).id,
      turnsRemaining: state.turnsRemaining,
    });
    return;
  }
  const nextIdx = nextAliveIndex(state, state.currentPlayerIndex);
  state.currentPlayerIndex = nextIdx;
  state.turnsRemaining = 1;
  state.attacked = false;
  events.push({ type: 'turn_changed', playerId: state.players[nextIdx].id, turnsRemaining: 1 });
}

function checkGameOver(state: GameState, events: GameEvent[]): void {
  const alive = alivePlayers(state);
  if (alive.length <= 1 && state.phase === 'playing') {
    state.phase = 'gameOver';
    state.winnerId = alive[0]?.id;
    if (state.winnerId) events.push({ type: 'game_over', winnerId: state.winnerId });
  }
}

/**
 * Whether any player may still play a Nope against the current pending action.
 * The Nope window must stay open while this is true. Crucially this INCLUDES the
 * actor themselves when their action is currently set to be cancelled (an odd
 * number of Nopes stacked): they are allowed to play a Nope as a "Yup" to
 * re-enable it (see {@link handleNope}). Returns false when nothing is pending.
 *
 * The server uses this to decide when to resolve a Nope window immediately
 * instead of arming a timer — so it must not exclude a player who still has a
 * legal response, or that response is silently denied.
 */
export function canRespondToPending(state: GameState): boolean {
  const pending = state.pending;
  if (!pending) return false;
  return state.players.some((p) => {
    if (!p.alive || !p.connected) return false;
    if (!p.hand.some((c) => c.type === CardType.Nope)) return false;
    // The actor can only respond when their own action is currently cancelled
    // (odd count) — i.e. play a Nope as a "Yup"; never on an uncancelled action.
    if (p.id === pending.by) return pending.nopes % 2 === 1;
    return true;
  });
}

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------

/**
 * Apply an authorial game action and return the new state + events.
 * Pure: never mutates the input state. Returns ok:false with an error for
 * illegal moves (state unchanged).
 */
export function applyAction(
  prev: GameState,
  action: GameAction,
  opts?: { rngSeed?: number },
): ApplyResult {
  if (prev.phase !== 'playing') return { ok: false, error: 'Game is not in progress' };

  // Deep-ish clone (cards are immutable value objects, so shallow-copy arrays).
  const state: GameState = {
    ...prev,
    players: prev.players.map((p) => ({ ...p, hand: [...p.hand] })),
    drawPile: [...prev.drawPile],
    discardPile: [...prev.discardPile],
    pending: prev.pending ? { ...prev.pending, playedCardIds: [...prev.pending.playedCardIds] } : undefined,
    awaiting: prev.awaiting ? { ...prev.awaiting } : undefined,
    reversibleTurnPass: prev.reversibleTurnPass ? { ...prev.reversibleTurnPass } : undefined,
  };
  const events: GameEvent[] = [];

  const result = route(state, action, events, opts?.rngSeed);
  if (result) return result; // error path

  checkGameOver(state, events);
  state.version = prev.version + 1;
  return { ok: true, state, events };
}

function route(
  state: GameState,
  action: GameAction,
  events: GameEvent[],
  rngSeed?: number,
): ApplyResult | null {
  switch (action.type) {
    case 'play':
      return handlePlay(state, action, events);
    case 'nope':
      return handleNope(state, action, events);
    case 'resolve_pending':
      return resolvePending(state, events, rngSeed);
    case 'draw':
      return handleDraw(state, action, events);
    case 'defuse':
      return handleDefuse(state, action, events);
    case 'give_favor_card':
      return handleGiveFavor(state, action, events);
    case 'steal_pick':
      return handleStealPick(state, action, events);
    default:
      return { ok: false, error: 'Unknown action' };
  }
}

function handlePlay(
  state: GameState,
  action: Extract<GameAction, { type: 'play' }>,
  events: GameEvent[],
): ApplyResult | null {
  if (state.awaiting) return { ok: false, error: 'Resolve the pending prompt first' };
  if (state.pending) return { ok: false, error: 'An action is awaiting Nope resolution' };

  const player = state.players.find((p) => p.id === action.playerId);
  if (!player || !player.alive) return { ok: false, error: 'Not an active player' };
  if (player.id !== currentPlayer(state).id) return { ok: false, error: 'Not your turn' };

  // Taking any action locks in the Attack/Skip that handed you this turn — you
  // can no longer bounce it back. (Reversing it is a Nope, routed elsewhere.)
  state.reversibleTurnPass = undefined;

  const { remaining, removed } = removeCards(player.hand, action.cardIds);
  if (removed.length !== action.cardIds.length) return { ok: false, error: 'You do not hold those cards' };
  if (removed.length === 0) return { ok: false, error: 'No cards selected' };

  // Determine whether this is a combo or a single action card.
  let kind: PendingKind;
  let combo: ComboKind | undefined;

  if (removed.length === 1) {
    const t = removed[0].type;
    if (isCatCard(t)) return { ok: false, error: 'A single cat card has no effect' };
    if (t === CardType.Defuse || t === CardType.ExplodingKitten || t === CardType.Nope) {
      return { ok: false, error: 'That card cannot be played this way' };
    }
    kind = t;
  } else {
    const comboResult = classifyCombo(removed, action.combo);
    if (!comboResult.ok) return { ok: false, error: comboResult.error };
    combo = comboResult.combo;
    kind = comboResult.combo;

    // Honour the host's house rules — a disabled combo cannot be played.
    const opts = gameOptions(state);
    if (combo === 'pair' && !opts.allowPairSteal) {
      return { ok: false, error: 'Pairs are disabled in this game' };
    }
    if (combo === 'triple' && !opts.allowTripleDemand) {
      return { ok: false, error: 'Three-of-a-kind is disabled in this game' };
    }
    if (combo === 'five_different' && !opts.allowFiveDifferent) {
      return { ok: false, error: 'The five-different combo is disabled in this game' };
    }
  }

  // Validate combo targets/params up front.
  if (combo === 'pair' || combo === 'triple') {
    if (!action.target) return { ok: false, error: 'Choose a target player' };
    const target = state.players.find((p) => p.id === action.target);
    if (!target || !target.alive || target.id === player.id) return { ok: false, error: 'Invalid target' };
    if (combo === 'triple') {
      if (!action.namedCard) return { ok: false, error: 'Name a card for the triple' };
      // You can't demand the Exploding Kitten — it's never a held, surrenderable card.
      if (action.namedCard === CardType.ExplodingKitten) {
        return { ok: false, error: 'You cannot name the Exploding Kitten' };
      }
    }
  }
  if (combo === 'five_different') {
    if (!action.discardCardId) return { ok: false, error: 'Pick a card from the discard pile' };
    const chosen = state.discardPile.find((c) => c.id === action.discardCardId);
    if (!chosen) return { ok: false, error: 'That card is not in the discard pile' };
    // An exploded player's Exploding Kitten lands in the discard; it must not be
    // fishable back into a live hand via the five-different combo.
    if (chosen.type === CardType.ExplodingKitten) {
      return { ok: false, error: 'You cannot take an Exploding Kitten from the discard pile' };
    }
  }
  if (kind === CardType.Favor) {
    if (!action.target) return { ok: false, error: 'Choose a player for the favor' };
    const target = state.players.find((p) => p.id === action.target);
    if (!target || !target.alive || target.id === player.id) return { ok: false, error: 'Invalid target' };
  }

  // Commit: discard the played cards and open the Nope window.
  player.hand = remaining;
  state.discardPile.push(...removed);
  state.pending = {
    by: player.id,
    kind,
    target: action.target,
    namedCard: action.namedCard,
    discardCardId: action.discardCardId,
    playedCardIds: removed.map((c) => c.id),
    nopes: 0,
  };
  events.push({ type: 'cards_played', by: player.id, cards: removed, combo, target: action.target });
  return null;
}

type PendingKind = CardType | ComboKind;

function classifyCombo(
  cards: Card[],
  declared?: ComboKind,
): { ok: true; combo: ComboKind } | { ok: false; error: string } {
  const types = cards.map((c) => c.type);
  const unique = new Set(types);

  // An Exploding Kitten can never be part of a combo (you'd be eliminated holding one).
  if (types.includes(CardType.ExplodingKitten)) {
    return { ok: false, error: 'Exploding Kittens cannot be played in a combo' };
  }

  if (cards.length === 2 && unique.size === 1) return { ok: true, combo: 'pair' };
  if (cards.length === 3 && unique.size === 1) return { ok: true, combo: 'triple' };
  if (cards.length === 5 && unique.size === 5) return { ok: true, combo: 'five_different' };

  // Helpful, specific errors.
  if (declared === 'pair') return { ok: false, error: 'A pair needs two identical cards' };
  if (declared === 'triple') return { ok: false, error: 'A triple needs three identical cards' };
  if (declared === 'five_different') return { ok: false, error: 'Needs five different cards' };
  return { ok: false, error: 'Not a valid combo' };
}

function handleNope(
  state: GameState,
  action: Extract<GameAction, { type: 'nope' }>,
  events: GameEvent[],
): ApplyResult | null {
  // No open window? This may still be a turn-pass reversal: the new current
  // player Noping the Attack/Skip that just landed on them.
  if (!state.pending) return reverseTurnPass(state, action, events);
  // The actor may not Nope their own action while it's currently set to resolve
  // (even Nope count). They MAY play a Nope as a "Yup" to counter an opponent's
  // Nope (odd count), which re-enables their action.
  if (state.pending.by === action.playerId && state.pending.nopes % 2 === 0) {
    return { ok: false, error: 'You cannot Nope your own action' };
  }
  const player = state.players.find((p) => p.id === action.playerId);
  if (!player || !player.alive) return { ok: false, error: 'Not an active player' };
  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card || card.type !== CardType.Nope) return { ok: false, error: 'You have no Nope card' };

  player.hand = player.hand.filter((c) => c.id !== action.cardId);
  state.discardPile.push(card);
  state.pending.nopes += 1;
  events.push({ type: 'nope', by: player.id, nopes: state.pending.nopes });
  return null;
}

/**
 * Reverse a resolved Attack/Skip at the start of the new current player's turn.
 * Only that player may do it, only before they have acted (any play/draw clears
 * {@link GameState.reversibleTurnPass}), and only while holding a Nope. Bouncing
 * restores the previous player's pre-action turn state exactly — they get their
 * turn back and must now draw to end it, the spent card aside.
 */
function reverseTurnPass(
  state: GameState,
  action: Extract<GameAction, { type: 'nope' }>,
  events: GameEvent[],
): ApplyResult | null {
  const rev = state.reversibleTurnPass;
  if (!rev) return { ok: false, error: 'Nothing to Nope' };
  if (rev.victimId !== action.playerId) return { ok: false, error: 'Only the current player can Nope that now' };
  const player = state.players.find((p) => p.id === action.playerId);
  if (!player || !player.alive) return { ok: false, error: 'Not an active player' };
  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card || card.type !== CardType.Nope) return { ok: false, error: 'You have no Nope card' };

  player.hand = player.hand.filter((c) => c.id !== action.cardId);
  state.discardPile.push(card);

  // Restore the previous player exactly as they were before the Attack/Skip.
  state.currentPlayerIndex = rev.prevPlayerIndex;
  state.turnsRemaining = rev.prevTurnsRemaining;
  state.attacked = rev.prevAttacked;
  state.reversibleTurnPass = undefined;

  const restoredTo = state.players[rev.prevPlayerIndex];
  events.push({ type: 'turn_pass_reversed', kind: rev.kind, reverser: player.id, restoredTo: restoredTo.id });
  events.push({ type: 'turn_changed', playerId: restoredTo.id, turnsRemaining: state.turnsRemaining });
  return null;
}

/** Resolve the pending action once the Nope window closes. */
function resolvePending(
  state: GameState,
  events: GameEvent[],
  rngSeed?: number,
): ApplyResult | null {
  const pending = state.pending;
  if (!pending) return { ok: false, error: 'Nothing pending' };
  state.pending = undefined;

  const cancelled = pending.nopes % 2 === 1;
  events.push({ type: 'action_resolved', kind: pending.kind, cancelled });
  if (cancelled) return null; // Noped: discard already happened, no effect.

  applyEffect(state, pending, events, rngSeed);
  return null;
}

function applyEffect(
  state: GameState,
  pending: NonNullable<GameState['pending']>,
  events: GameEvent[],
  rngSeed?: number,
): void {
  const actor = state.players.find((p) => p.id === pending.by);
  if (!actor) return;

  switch (pending.kind) {
    case CardType.Attack: {
      // End all of the current player's turns. A fresh (non-attacked) player
      // passes exactly 2; a player already serving attack-turns passes their
      // remaining turns + 2 (official stacking, e.g. owed 2 -> next owes 4,
      // owed 1 after taking one -> next owes 3).
      const prevPlayerIndex = state.currentPlayerIndex;
      const prevTurnsRemaining = state.turnsRemaining;
      const prevAttacked = state.attacked;
      const carried = state.attacked ? state.turnsRemaining : 0;
      const opts = gameOptions(state);
      const nextTurns = opts.limitAttackStacking
        ? Math.min(carried + RULES.attackTurns, opts.maxAttackTurns)
        : carried + RULES.attackTurns;
      const nextIdx = nextAliveIndex(state, state.currentPlayerIndex);
      state.currentPlayerIndex = nextIdx;
      state.turnsRemaining = nextTurns;
      state.attacked = true;
      // The victim may bounce this back at the start of their turn (see
      // reverseTurnPass). An Attack always changes whose turn it is.
      state.reversibleTurnPass = {
        kind: CardType.Attack,
        by: pending.by,
        prevPlayerIndex,
        prevTurnsRemaining,
        prevAttacked,
        victimId: state.players[nextIdx].id,
      };
      events.push({ type: 'turn_changed', playerId: state.players[nextIdx].id, turnsRemaining: nextTurns });
      break;
    }
    case CardType.Skip: {
      // End one turn without drawing.
      const prevPlayerIndex = state.currentPlayerIndex;
      const prevTurnsRemaining = state.turnsRemaining;
      const prevAttacked = state.attacked;
      endTurn(state, events);
      // Only reversible when the Skip actually handed the turn to someone else.
      // A Skip that just burns one of several stacked turns keeps the same
      // player up, so there is nothing to bounce back.
      if (state.currentPlayerIndex !== prevPlayerIndex) {
        state.reversibleTurnPass = {
          kind: CardType.Skip,
          by: pending.by,
          prevPlayerIndex,
          prevTurnsRemaining,
          prevAttacked,
          victimId: currentPlayer(state).id,
        };
      }
      break;
    }
    case CardType.Shuffle: {
      // Use server-injected entropy when available so the new order is genuinely
      // unpredictable; fall back to a version-seeded shuffle for deterministic tests.
      const seed = rngSeed ?? (state.version + 1) * 2654435761;
      state.drawPile = shuffle(state.drawPile, createRng(seed));
      events.push({ type: 'shuffled' });
      break;
    }
    case CardType.SeeTheFuture: {
      const top = state.drawPile.slice(0, RULES.seeTheFutureCount);
      events.push({ type: 'see_future', by: actor.id, cards: top });
      break;
    }
    case CardType.Favor: {
      const target = state.players.find((p) => p.id === pending.target);
      if (target && target.alive) {
        // Event convention: `from` = the player who must give a card (the target),
        // `to` = the requester (the actor who played Favor). Consistent in both branches.
        if (target.hand.length === 0) {
          // Nothing to give; favor fizzles.
          events.push({ type: 'favor_requested', from: target.id, to: actor.id });
        } else {
          state.awaiting = { type: 'favor_give', playerId: target.id, toPlayerId: actor.id };
          events.push({ type: 'favor_requested', from: target.id, to: actor.id });
        }
      }
      break;
    }
    case 'pair': {
      // A pair lets you take a *random* card — faithfully, the thief picks one
      // blindly from the target's face-down hand. Open that choice rather than
      // resolving it server-side, so the victim can rearrange to thwart them.
      beginStealPick(state, actor.id, pending.target, 'pair');
      break;
    }
    case 'triple': {
      stealNamed(state, actor.id, pending.target, pending.namedCard, events);
      break;
    }
    case 'five_different': {
      takeFromDiscard(state, actor.id, pending.discardCardId, events);
      break;
    }
    default:
      break;
  }
}

/**
 * Open a blind steal: the thief must pick one of the target's face-down cards
 * (handled by {@link handleStealPick}). No-op (combo fizzles) if the target has
 * no cards to take.
 */
function beginStealPick(
  state: GameState,
  byId: string,
  targetId: string | undefined,
  via: ComboKind,
): void {
  const by = state.players.find((p) => p.id === byId);
  const target = state.players.find((p) => p.id === targetId);
  if (!by || !target || !target.alive || target.hand.length === 0) return;
  state.awaiting = { type: 'steal_pick', playerId: by.id, fromPlayerId: target.id, via };
}

/** Resolve a blind steal once the thief picks an index into the target's hand. */
function handleStealPick(
  state: GameState,
  action: Extract<GameAction, { type: 'steal_pick' }>,
  events: GameEvent[],
): ApplyResult | null {
  const awaiting = state.awaiting;
  if (!awaiting || awaiting.type !== 'steal_pick') return { ok: false, error: 'No steal to resolve' };
  if (awaiting.playerId !== action.playerId) return { ok: false, error: 'Not your steal to make' };
  const by = state.players.find((p) => p.id === action.playerId);
  const target = state.players.find((p) => p.id === awaiting.fromPlayerId);
  const via = awaiting.via;
  state.awaiting = undefined;
  // If the target emptied out somehow, the steal simply fizzles.
  if (!by || !target || !target.alive || target.hand.length === 0) return null;
  // Clamp the (untrusted) index so an out-of-range pick can't crash or miss.
  const idx = Math.max(0, Math.min(action.cardIndex, target.hand.length - 1));
  const [card] = target.hand.splice(idx, 1);
  by.hand.push(card);
  events.push({ type: 'stole', by: by.id, from: target.id, viaCombo: via, card });
  return null;
}

function stealNamed(
  state: GameState,
  byId: string,
  targetId: string | undefined,
  named: CardType | undefined,
  events: GameEvent[],
): void {
  const by = state.players.find((p) => p.id === byId);
  const target = state.players.find((p) => p.id === targetId);
  if (!by || !target || !target.alive || !named) return;
  const idx = target.hand.findIndex((c) => c.type === named);
  if (idx === -1) {
    // Target doesn't have the named card — combo is spent but nothing is taken,
    // and we emit no 'stole' event so the log doesn't falsely claim a steal.
    return;
  }
  const [card] = target.hand.splice(idx, 1);
  by.hand.push(card);
  events.push({ type: 'stole', by: byId, from: target.id, viaCombo: 'triple', card });
}

function takeFromDiscard(
  state: GameState,
  byId: string,
  discardCardId: string | undefined,
  events: GameEvent[],
): void {
  const by = state.players.find((p) => p.id === byId);
  if (!by || !discardCardId) return;
  const idx = state.discardPile.findIndex((c) => c.id === discardCardId);
  if (idx === -1) return;
  const [card] = state.discardPile.splice(idx, 1);
  by.hand.push(card);
  events.push({ type: 'took_from_discard', by: byId, card });
}

function handleDraw(
  state: GameState,
  action: Extract<GameAction, { type: 'draw' }>,
  events: GameEvent[],
): ApplyResult | null {
  if (state.pending) return { ok: false, error: 'Resolve the Nope window first' };
  if (state.awaiting) return { ok: false, error: 'Resolve the pending prompt first' };
  const player = currentPlayer(state);
  if (player.id !== action.playerId) return { ok: false, error: 'Not your turn' };
  if (state.drawPile.length === 0) return { ok: false, error: 'Draw pile is empty' };

  // Drawing locks in the Attack/Skip that handed you this turn — too late to
  // bounce it back.
  state.reversibleTurnPass = undefined;

  const card = state.drawPile.shift()!;

  if (card.type === CardType.ExplodingKitten) {
    // No card on the event: an Exploding Kitten never lands face up in the hand,
    // and the defuse/explosion flow drives the visuals instead.
    events.push({ type: 'card_drawn', by: player.id });
    const hasDefuse = player.hand.some((c) => c.type === CardType.Defuse);
    if (hasDefuse) {
      // Hold the kitten off-pile on the awaiting record so it never leaks into
      // the public discard view while the player decides whether to defuse.
      state.awaiting = { type: 'defuse_or_explode', playerId: player.id, explodingCard: card };
      return null;
    }
    // No defuse: explode.
    explode(state, player, card, events);
    return null;
  }

  // Normal draw: add to hand and end one turn. The drawn card rides on the event
  // (redacted to everyone but the drawer) so the drawer can reveal it face up.
  events.push({ type: 'card_drawn', by: player.id, card });
  player.hand.push(card);
  endTurn(state, events);
  return null;
}

function explode(state: GameState, player: PlayerState, ek: Card, events: GameEvent[]): void {
  player.alive = false;
  // Exploded player's hand is discarded.
  state.discardPile.push(...player.hand, ek);
  player.hand = [];
  events.push({ type: 'exploded', playerId: player.id });
  // Their turn is over; move on (unless game ends).
  if (alivePlayers(state).length > 1) {
    const nextIdx = nextAliveIndex(state, state.currentPlayerIndex);
    state.currentPlayerIndex = nextIdx;
    state.turnsRemaining = 1;
    state.attacked = false;
    events.push({ type: 'turn_changed', playerId: state.players[nextIdx].id, turnsRemaining: 1 });
  }
}

function handleDefuse(
  state: GameState,
  action: Extract<GameAction, { type: 'defuse' }>,
  events: GameEvent[],
): ApplyResult | null {
  const awaiting = state.awaiting;
  if (!awaiting || awaiting.type !== 'defuse_or_explode') return { ok: false, error: 'Nothing to defuse' };
  if (awaiting.playerId !== action.playerId) return { ok: false, error: 'Not your defuse to play' };
  const player = state.players.find((p) => p.id === action.playerId)!;
  const defuse = player.hand.find((c) => c.id === action.cardId && c.type === CardType.Defuse);
  if (!defuse) return { ok: false, error: 'You have no Defuse card' };

  // Spend the defuse.
  player.hand = player.hand.filter((c) => c.id !== action.cardId);
  state.discardPile.push(defuse);

  // Reinsert the held-aside Exploding Kitten at the chosen (clamped) position.
  const ek = awaiting.explodingCard;
  const pos = Math.max(0, Math.min(action.insertPosition, state.drawPile.length));
  state.drawPile.splice(pos, 0, ek);

  state.awaiting = undefined;
  events.push({ type: 'defused', playerId: player.id });
  // Defusing completes one turn (the draw that triggered it).
  endTurn(state, events);
  return null;
}

function handleGiveFavor(
  state: GameState,
  action: Extract<GameAction, { type: 'give_favor_card' }>,
  events: GameEvent[],
): ApplyResult | null {
  const awaiting = state.awaiting;
  if (!awaiting || awaiting.type !== 'favor_give') return { ok: false, error: 'No favor pending' };
  if (awaiting.playerId !== action.playerId) return { ok: false, error: 'Not your card to give' };
  const giver = state.players.find((p) => p.id === action.playerId)!;
  const receiver = state.players.find((p) => p.id === awaiting.toPlayerId);
  const card = giver.hand.find((c) => c.id === action.cardId);
  if (!card) return { ok: false, error: 'You do not hold that card' };
  if (!receiver) return { ok: false, error: 'Receiver is gone' };

  giver.hand = giver.hand.filter((c) => c.id !== action.cardId);
  receiver.hand.push(card);
  state.awaiting = undefined;
  events.push({ type: 'card_given', from: giver.id, to: receiver.id });
  return null;
}

/** Re-export for the server to inject a true-random deck order on Shuffle. */
export function setDrawPileOrder(state: GameState, order: Card[]): GameState {
  return { ...state, drawPile: order };
}

/**
 * Reorder one player's own hand to the given id order. A player's hand order is
 * private (others only see a count) but it matters for the blind pair-steal, so
 * this is server-authoritative. `order` must be an exact permutation of the
 * player's current hand ids; anything else (wrong length, unknown/duplicate id)
 * returns null and the caller should ignore it. Does not bump `version` — it is
 * a private, cosmetic rearrange applied outside the main action pipeline.
 */
export function reorderHand(state: GameState, playerId: string, order: string[]): GameState | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || order.length !== player.hand.length) return null;
  const byId = new Map(player.hand.map((c) => [c.id, c]));
  const next: Card[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const card = byId.get(id);
    if (!card || seen.has(id)) return null; // unknown or duplicate id => not a permutation
    seen.add(id);
    next.push(card);
  }
  const players = state.players.map((p) => (p.id === playerId ? { ...p, hand: next } : p));
  return { ...state, players };
}

export { NOPEABLE_ACTIONS };
