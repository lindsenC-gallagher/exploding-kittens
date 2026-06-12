import { describe, expect, it } from 'vitest';
import { CardType, BASE_DECK_COMPOSITION, RULES } from './cards.js';
import {
  addPlayer,
  applyAction,
  createLobby,
  startGame,
  type GameAction,
} from './engine.js';
import type { Card } from './cards.js';
import type { GameState } from './state.js';

/** Build a lobby with `n` named players (p0..pn-1). */
function lobbyWith(n: number): GameState {
  let state = createLobby('p0');
  for (let i = 0; i < n; i++) {
    const r = addPlayer(state, `p${i}`, `Player ${i}`);
    expect(r.ok).toBe(true);
    if (r.ok) state = r.state;
  }
  return state;
}

function started(n: number, seed = 123): GameState {
  const r = startGame(lobbyWith(n), seed);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function apply(state: GameState, action: GameAction): GameState {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(`action ${action.type} failed: ${r.error}`);
  return r.state;
}

/** Give the current player a specific card by mutating a test copy. */
function withCardInHand(state: GameState, playerId: string, type: CardType): { state: GameState; cardId: string } {
  const card: Card = { id: `inject-${type}-${Math.round(Math.random() * 1e9)}`, type };
  const players = state.players.map((p) =>
    p.id === playerId ? { ...p, hand: [...p.hand, card] } : p,
  );
  return { state: { ...state, players }, cardId: card.id };
}

function player(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

function current(state: GameState) {
  return state.players[state.currentPlayerIndex];
}

describe('deck composition & setup', () => {
  it('has 56 cards total in the box', () => {
    const total = Object.values(BASE_DECK_COMPOSITION).reduce((a, b) => a + b, 0);
    expect(total).toBe(56);
  });

  it('deals startingHandSize + 1 Defuse to each player', () => {
    const state = started(4);
    for (const p of state.players) {
      expect(p.hand.length).toBe(RULES.startingHandSize + 1);
      expect(p.hand.filter((c) => c.type === CardType.Defuse).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('inserts (players - 1) Exploding Kittens into the draw pile', () => {
    for (const n of [2, 3, 4, 5]) {
      const state = started(n);
      const eks = state.drawPile.filter((c) => c.type === CardType.ExplodingKitten).length;
      expect(eks).toBe(n - 1);
    }
  });

  it('no Exploding Kittens are dealt into starting hands', () => {
    const state = started(5);
    for (const p of state.players) {
      expect(p.hand.some((c) => c.type === CardType.ExplodingKitten)).toBe(false);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = started(4, 999);
    const b = started(4, 999);
    expect(a.drawPile.map((c) => c.type)).toEqual(b.drawPile.map((c) => c.type));
  });

  it('rejects starting with fewer than 2 players', () => {
    const r = startGame(lobbyWith(1), 1);
    expect(r.ok).toBe(false);
  });
});

describe('turn flow & drawing', () => {
  it('drawing a normal card advances to the next player', () => {
    let state = started(3);
    const first = current(state).id;
    state = apply(state, { type: 'draw', playerId: first });
    expect(current(state).id).not.toBe(first);
  });

  it('rejects a draw from a player who is not the current player', () => {
    const state = started(3);
    const notCurrent = state.players.find((p) => p.id !== current(state).id)!;
    const r = applyAction(state, { type: 'draw', playerId: notCurrent.id });
    expect(r.ok).toBe(false);
  });
});

describe('Skip', () => {
  it('ends the turn without drawing', () => {
    let state = started(3);
    const me = current(state).id;
    const injected = withCardInHand(state, me, CardType.Skip);
    state = injected.state;
    const drawPileBefore = state.drawPile.length;
    state = apply(state, { type: 'play', playerId: me, cardIds: [injected.cardId] });
    state = apply(state, { type: 'resolve_pending' });
    expect(current(state).id).not.toBe(me);
    expect(state.drawPile.length).toBe(drawPileBefore); // no draw happened
  });
});

describe('Attack', () => {
  it('forces the next player to take 2 turns', () => {
    let state = started(3);
    const me = current(state).id;
    const injected = withCardInHand(state, me, CardType.Attack);
    state = injected.state;
    state = apply(state, { type: 'play', playerId: me, cardIds: [injected.cardId] });
    state = apply(state, { type: 'resolve_pending' });
    expect(current(state).id).not.toBe(me);
    expect(state.turnsRemaining).toBe(2);
  });

  it('stacks: an attacked player who attacks passes 4 turns onward', () => {
    let state = started(3);
    const p0 = current(state).id;
    let inj = withCardInHand(state, p0, CardType.Attack);
    state = inj.state;
    state = apply(state, { type: 'play', playerId: p0, cardIds: [inj.cardId] });
    state = apply(state, { type: 'resolve_pending' });

    const p1 = current(state).id;
    expect(state.turnsRemaining).toBe(2);
    inj = withCardInHand(state, p1, CardType.Attack);
    state = inj.state;
    state = apply(state, { type: 'play', playerId: p1, cardIds: [inj.cardId] });
    state = apply(state, { type: 'resolve_pending' });

    expect(current(state).id).not.toBe(p1);
    expect(state.turnsRemaining).toBe(4);
  });
});

describe('See the Future', () => {
  it('reveals exactly the top 3 cards without changing the deck', () => {
    let state = started(3);
    const me = current(state).id;
    const top3 = state.drawPile.slice(0, 3).map((c) => c.id);
    const inj = withCardInHand(state, me, CardType.SeeTheFuture);
    state = inj.state;
    const r = applyAction(state, { type: 'play', playerId: me, cardIds: [inj.cardId] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const r2 = applyAction(r.state, { type: 'resolve_pending' });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const ev = r2.events.find((e) => e.type === 'see_future');
    expect(ev && ev.type === 'see_future' && ev.cards.map((c) => c.id)).toEqual(top3);
    expect(r2.state.drawPile.slice(0, 3).map((c) => c.id)).toEqual(top3);
  });
});

describe('Nope', () => {
  it('an odd number of Nopes cancels the action', () => {
    let state = started(3);
    const me = current(state).id;
    const other = state.players.find((p) => p.id !== me)!.id;
    const skip = withCardInHand(state, me, CardType.Skip);
    state = skip.state;
    const nope = withCardInHand(state, other, CardType.Nope);
    state = nope.state;

    state = apply(state, { type: 'play', playerId: me, cardIds: [skip.cardId] });
    state = apply(state, { type: 'nope', playerId: other, cardId: nope.cardId });
    state = apply(state, { type: 'resolve_pending' });
    // Skip was noped: still the same player's turn.
    expect(current(state).id).toBe(me);
  });

  it('an even number of Nopes (Yup) lets the action through', () => {
    let state = started(3);
    const me = current(state).id;
    const other = state.players.find((p) => p.id !== me)!.id;
    const skip = withCardInHand(state, me, CardType.Skip);
    state = skip.state;
    const nope = withCardInHand(state, other, CardType.Nope);
    state = nope.state;
    const yup = withCardInHand(state, me, CardType.Nope);
    state = yup.state;

    state = apply(state, { type: 'play', playerId: me, cardIds: [skip.cardId] });
    state = apply(state, { type: 'nope', playerId: other, cardId: nope.cardId });
    state = apply(state, { type: 'nope', playerId: me, cardId: yup.cardId });
    state = apply(state, { type: 'resolve_pending' });
    // Skip went through: turn advanced.
    expect(current(state).id).not.toBe(me);
  });
});

describe('Favor', () => {
  it('forces the target to give a chosen card', () => {
    let state = started(3);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    const favor = withCardInHand(state, me, CardType.Favor);
    state = favor.state;

    state = apply(state, { type: 'play', playerId: me, cardIds: [favor.cardId], target });
    state = apply(state, { type: 'resolve_pending' });
    expect(state.awaiting?.type).toBe('favor_give');

    const giveCard = player(state, target).hand[0];
    const beforeMine = player(state, me).hand.length;
    state = apply(state, { type: 'give_favor_card', playerId: target, cardId: giveCard.id });
    expect(player(state, me).hand.length).toBe(beforeMine + 1);
    expect(player(state, me).hand.some((c) => c.id === giveCard.id)).toBe(true);
    expect(state.awaiting).toBeUndefined();
  });
});

describe('combos', () => {
  it('a pair steals a random card from the target', () => {
    let state = started(3);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    const a = withCardInHand(state, me, CardType.Tacocat);
    state = a.state;
    const b = withCardInHand(state, me, CardType.Tacocat);
    state = b.state;

    const targetBefore = player(state, target).hand.length;
    const mineBefore = player(state, me).hand.length;
    state = apply(state, { type: 'play', playerId: me, cardIds: [a.cardId, b.cardId], combo: 'pair', target });
    state = apply(state, { type: 'resolve_pending' });
    expect(player(state, target).hand.length).toBe(targetBefore - 1);
    // me: -2 cat cards + 1 stolen = mineBefore - 1
    expect(player(state, me).hand.length).toBe(mineBefore - 1);
  });

  it('a single cat card cannot be played', () => {
    let state = started(3);
    const me = current(state).id;
    const a = withCardInHand(state, me, CardType.Tacocat);
    state = a.state;
    const r = applyAction(state, { type: 'play', playerId: me, cardIds: [a.cardId] });
    expect(r.ok).toBe(false);
  });

  it('a triple takes a named card if the target has it', () => {
    let state = started(3);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    // give target a known card to name
    const targetCard = withCardInHand(state, target, CardType.Shuffle);
    state = targetCard.state;
    const c1 = withCardInHand(state, me, CardType.BeardCat);
    state = c1.state;
    const c2 = withCardInHand(state, me, CardType.BeardCat);
    state = c2.state;
    const c3 = withCardInHand(state, me, CardType.BeardCat);
    state = c3.state;

    state = apply(state, {
      type: 'play',
      playerId: me,
      cardIds: [c1.cardId, c2.cardId, c3.cardId],
      combo: 'triple',
      target,
      namedCard: CardType.Shuffle,
    });
    state = apply(state, { type: 'resolve_pending' });
    expect(player(state, me).hand.some((c) => c.id === targetCard.cardId)).toBe(true);
  });
});

describe('Exploding Kitten & Defuse', () => {
  it('a player with no Defuse explodes and is eliminated', () => {
    let state = started(3);
    const me = current(state).id;
    // Strip defuse from current player and force an EK on top.
    const ek: Card = { id: 'ek-top', type: CardType.ExplodingKitten };
    state = {
      ...state,
      players: state.players.map((p) => (p.id === me ? { ...p, hand: p.hand.filter((c) => c.type !== CardType.Defuse) } : p)),
      drawPile: [ek, ...state.drawPile],
    };
    state = apply(state, { type: 'draw', playerId: me });
    expect(player(state, me).alive).toBe(false);
  });

  it('a player with a Defuse survives and reinserts the kitten', () => {
    let state = started(3);
    const me = current(state).id;
    const ek: Card = { id: 'ek-top', type: CardType.ExplodingKitten };
    state = { ...state, drawPile: [ek, ...state.drawPile] };
    state = apply(state, { type: 'draw', playerId: me });
    expect(state.awaiting?.type).toBe('defuse_or_explode');

    const defuse = player(state, me).hand.find((c) => c.type === CardType.Defuse)!;
    const drawCountBefore = state.drawPile.length;
    state = apply(state, { type: 'defuse', playerId: me, cardId: defuse.id, insertPosition: 0 });
    expect(player(state, me).alive).toBe(true);
    expect(state.drawPile.length).toBe(drawCountBefore + 1); // EK reinserted
    expect(state.drawPile[0].id).toBe('ek-top'); // inserted at position 0
  });
});

describe('win condition', () => {
  it('declares the last surviving player the winner', () => {
    let state = started(2);
    const me = current(state).id;
    const ek: Card = { id: 'ek-top', type: CardType.ExplodingKitten };
    state = {
      ...state,
      players: state.players.map((p) => (p.id === me ? { ...p, hand: p.hand.filter((c) => c.type !== CardType.Defuse) } : p)),
      drawPile: [ek, ...state.drawPile],
    };
    state = apply(state, { type: 'draw', playerId: me });
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBe(state.players.find((p) => p.id !== me)!.id);
  });
});
