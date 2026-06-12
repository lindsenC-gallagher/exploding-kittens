import {
  BASE_DECK_COMPOSITION,
  CardType,
  RULES,
  isCatCard,
  NOPEABLE_ACTIONS,
  type Card,
} from './cards.js';
import { createRng, shuffle, type Rng } from './rng.js';
import type {
  ApplyResult,
  ComboKind,
  GameEvent,
  GameState,
  PlayerState,
} from './state.js';

/** Engine-level actions. The server is responsible for authenticating playerId. */
export type GameAction =
  | { type: 'play'; playerId: string; cardIds: string[]; combo?: ComboKind; target?: string; namedCard?: CardType; discardCardId?: string }
  | { type: 'nope'; playerId: string; cardId: string }
  | { type: 'resolve_pending' }
  | { type: 'draw'; playerId: string }
  | { type: 'defuse'; playerId: string; cardId: string; insertPosition: number }
  | { type: 'give_favor_card'; playerId: string; cardId: string };

let cardCounter = 0;
function makeCard(type: CardType): Card {
  cardCounter += 1;
  return { id: `c${cardCounter}`, type };
}

/** Build the base deck minus Exploding Kittens and Defuse (added during setup). */
function buildBaseDeck(): Card[] {
  const cards: Card[] = [];
  for (const [type, count] of Object.entries(BASE_DECK_COMPOSITION)) {
    if (type === CardType.ExplodingKitten || type === CardType.Defuse) continue;
    for (let i = 0; i < count; i++) cards.push(makeCard(type as CardType));
  }
  return cards;
}

/**
 * Create the initial lobby state. Players join via {@link addPlayer}.
 */
export function createLobby(hostId: string): GameState {
  return {
    phase: 'lobby',
    hostId,
    players: [],
    currentPlayerIndex: 0,
    turnsRemaining: 1,
    drawPile: [],
    discardPile: [],
    version: 0,
  };
}

export function addPlayer(state: GameState, id: string, name: string): ApplyResult {
  if (state.phase !== 'lobby') return { ok: false, error: 'Game already started' };
  if (state.players.some((p) => p.id === id)) return { ok: false, error: 'Already joined' };
  if (state.players.length >= RULES.maxPlayers) return { ok: false, error: 'Lobby full' };
  const player: PlayerState = {
    id,
    name,
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

  const rng = createRng(seed);
  let deck = shuffle(buildBaseDeck(), rng);

  // Deal startingHandSize cards to each player, then give each one Defuse.
  const players = state.players.map((p) => ({ ...p, hand: [] as Card[], alive: true, ready: true }));
  for (let i = 0; i < RULES.startingHandSize; i++) {
    for (const p of players) {
      const card = deck.pop();
      if (card) p.hand.push(card);
    }
  }
  for (const p of players) p.hand.push(makeCard(CardType.Defuse));

  // Reinsert leftover Defuse cards (total 6 minus one per player) into the deck.
  const leftoverDefuse = Math.max(0, BASE_DECK_COMPOSITION[CardType.Defuse] - n);
  for (let i = 0; i < leftoverDefuse; i++) deck.push(makeCard(CardType.Defuse));

  // Insert (players - 1) Exploding Kittens.
  for (let i = 0; i < n - 1; i++) deck.push(makeCard(CardType.ExplodingKitten));

  deck = shuffle(deck, rng);

  const order = players.map((p) => p.id);
  return {
    ok: true,
    state: {
      ...state,
      phase: 'playing',
      players,
      drawPile: deck,
      discardPile: [],
      currentPlayerIndex: 0,
      turnsRemaining: 1,
      version: state.version + 1,
    },
    events: [
      { type: 'game_started', playerOrder: order },
      { type: 'turn_changed', playerId: order[0], turnsRemaining: 1 },
    ],
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

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------

/**
 * Apply an authorial game action and return the new state + events.
 * Pure: never mutates the input state. Returns ok:false with an error for
 * illegal moves (state unchanged).
 */
export function applyAction(prev: GameState, action: GameAction): ApplyResult {
  if (prev.phase !== 'playing') return { ok: false, error: 'Game is not in progress' };

  // Deep-ish clone (cards are immutable value objects, so shallow-copy arrays).
  const state: GameState = {
    ...prev,
    players: prev.players.map((p) => ({ ...p, hand: [...p.hand] })),
    drawPile: [...prev.drawPile],
    discardPile: [...prev.discardPile],
    pending: prev.pending ? { ...prev.pending, playedCardIds: [...prev.pending.playedCardIds] } : undefined,
    awaiting: prev.awaiting ? { ...prev.awaiting } : undefined,
  };
  const events: GameEvent[] = [];

  const result = route(state, action, events);
  if (result) return result; // error path

  checkGameOver(state, events);
  state.version = prev.version + 1;
  return { ok: true, state, events };
}

function route(state: GameState, action: GameAction, events: GameEvent[]): ApplyResult | null {
  switch (action.type) {
    case 'play':
      return handlePlay(state, action, events);
    case 'nope':
      return handleNope(state, action, events);
    case 'resolve_pending':
      return resolvePending(state, events);
    case 'draw':
      return handleDraw(state, action, events);
    case 'defuse':
      return handleDefuse(state, action, events);
    case 'give_favor_card':
      return handleGiveFavor(state, action, events);
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
  }

  // Validate combo targets/params up front.
  if (combo === 'pair' || combo === 'triple') {
    if (!action.target) return { ok: false, error: 'Choose a target player' };
    const target = state.players.find((p) => p.id === action.target);
    if (!target || !target.alive || target.id === player.id) return { ok: false, error: 'Invalid target' };
    if (combo === 'triple' && !action.namedCard) return { ok: false, error: 'Name a card for the triple' };
  }
  if (combo === 'five_different') {
    if (!action.discardCardId) return { ok: false, error: 'Pick a card from the discard pile' };
    if (!state.discardPile.some((c) => c.id === action.discardCardId)) {
      return { ok: false, error: 'That card is not in the discard pile' };
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
  events.push({ type: 'cards_played', by: player.id, cards: removed, combo });
  return null;
}

type PendingKind = CardType | ComboKind;

function classifyCombo(
  cards: Card[],
  declared?: ComboKind,
): { ok: true; combo: ComboKind } | { ok: false; error: string } {
  const types = cards.map((c) => c.type);
  const unique = new Set(types);

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
  if (!state.pending) return { ok: false, error: 'Nothing to Nope' };
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

/** Resolve the pending action once the Nope window closes. */
function resolvePending(state: GameState, events: GameEvent[]): ApplyResult | null {
  const pending = state.pending;
  if (!pending) return { ok: false, error: 'Nothing pending' };
  state.pending = undefined;

  const cancelled = pending.nopes % 2 === 1;
  events.push({ type: 'action_resolved', kind: pending.kind, cancelled });
  if (cancelled) return null; // Noped: discard already happened, no effect.

  applyEffect(state, pending, events);
  return null;
}

function applyEffect(
  state: GameState,
  pending: NonNullable<GameState['pending']>,
  events: GameEvent[],
): void {
  const actor = state.players.find((p) => p.id === pending.by);
  if (!actor) return;

  switch (pending.kind) {
    case CardType.Attack: {
      // End all of the current player's turns; next player takes the stack + 2.
      const carried = state.turnsRemaining > 1 ? state.turnsRemaining : 0;
      const nextTurns = carried + RULES.attackTurns;
      const nextIdx = nextAliveIndex(state, state.currentPlayerIndex);
      state.currentPlayerIndex = nextIdx;
      state.turnsRemaining = nextTurns;
      events.push({ type: 'turn_changed', playerId: state.players[nextIdx].id, turnsRemaining: nextTurns });
      break;
    }
    case CardType.Skip: {
      // End one turn without drawing.
      endTurn(state, events);
      break;
    }
    case CardType.Shuffle: {
      // Deterministic-by-server shuffle: caller injects randomness via reorder.
      // Here we rotate using a cheap derangement seeded by version for purity;
      // the server replaces drawPile order through a dedicated path if desired.
      state.drawPile = shuffleByVersion(state.drawPile, state.version);
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
        if (target.hand.length === 0) {
          // Nothing to give; favor fizzles.
          events.push({ type: 'favor_requested', from: actor.id, to: target.id });
        } else {
          state.awaiting = { type: 'favor_give', playerId: target.id, toPlayerId: actor.id };
          events.push({ type: 'favor_requested', from: target.id, to: actor.id });
        }
      }
      break;
    }
    case 'pair': {
      stealRandom(state, actor.id, pending.target, 'pair', events);
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

/** Stable shuffle helper for the Shuffle card (server may override deck order). */
function shuffleByVersion<T>(items: T[], version: number): T[] {
  const rng: Rng = createRng((version + 1) * 2654435761);
  return shuffle(items, rng);
}

function stealRandom(
  state: GameState,
  byId: string,
  targetId: string | undefined,
  via: ComboKind,
  events: GameEvent[],
): void {
  const by = state.players.find((p) => p.id === byId);
  const target = state.players.find((p) => p.id === targetId);
  if (!by || !target || !target.alive || target.hand.length === 0) return;
  const rng = createRng((state.version + 7) * 40503);
  const idx = rng.int(target.hand.length);
  const [card] = target.hand.splice(idx, 1);
  by.hand.push(card);
  events.push({ type: 'stole', by: byId, from: target.id, viaCombo: via });
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
    // Target doesn't have it — combo whiffs, but is still spent.
    events.push({ type: 'stole', by: byId, from: target.id, viaCombo: 'triple' });
    return;
  }
  const [card] = target.hand.splice(idx, 1);
  by.hand.push(card);
  events.push({ type: 'stole', by: byId, from: target.id, viaCombo: 'triple' });
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

  const card = state.drawPile.shift()!;
  events.push({ type: 'card_drawn', by: player.id });

  if (card.type === CardType.ExplodingKitten) {
    const hasDefuse = player.hand.some((c) => c.type === CardType.Defuse);
    if (hasDefuse) {
      state.awaiting = { type: 'defuse_or_explode', playerId: player.id, explodingCardId: card.id };
      // Hold the EK aside on the discard pile reference via awaiting; keep it out
      // of hand. We park it on discard temporarily and remove on defuse/explode.
      state.discardPile.push(card);
      return null;
    }
    // No defuse: explode.
    explode(state, player, card, events);
    return null;
  }

  // Normal draw: add to hand and end one turn.
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

  // Pull the EK back off the discard pile and reinsert it at chosen position.
  const ekIdx = state.discardPile.findIndex((c) => c.id === awaiting.explodingCardId);
  const [ek] = state.discardPile.splice(ekIdx, 1);
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

export { NOPEABLE_ACTIONS };
