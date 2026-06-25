import { describe, expect, it } from 'vitest';
import { CardType, BASE_DECK_COMPOSITION, RULES } from './cards.js';
import {
  addPlayer,
  applyAction,
  canRespondToPending,
  createLobby,
  reorderHand,
  resetToLobby,
  setOptions,
  startGame,
  type GameAction,
} from './engine.js';
import type { Card } from './cards.js';
import { MAX_ATTACK_TURNS, MIN_ATTACK_TURNS, type GameState } from './state.js';
import { projectSpectatorView, projectView, redactEventForRecipient, shouldSpectate } from './view.js';

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

/** Start a game with faithful (unlimited) Attack stacking for stacking tests. */
function startedUnlimitedAttack(n: number, seed = 123): GameState {
  const r = startGame(setOptions(lobbyWith(n), { limitAttackStacking: false }), seed);
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

  it('inserts (players - 1) Exploding Kittens into the draw pile (2-9 players)', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
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

  it('combines two decks for 6-9 players so full hands and a draw pile still fit', () => {
    for (const n of [6, 7, 8, 9]) {
      const state = started(n);
      for (const p of state.players) {
        expect(p.hand.length).toBe(RULES.startingHandSize + 1);
        expect(p.hand.some((c) => c.type === CardType.ExplodingKitten)).toBe(false);
      }
      // A single deck (46 cards) cannot deal 7 to 7+ players; two decks can, and
      // still leave a healthy draw pile.
      expect(state.drawPile.length).toBeGreaterThan(n);
    }
  });

  it('caps the lobby at maxPlayers', () => {
    const full = lobbyWith(RULES.maxPlayers);
    expect(full.players).toHaveLength(RULES.maxPlayers);
    const overflow = addPlayer(full, 'extra', 'Extra');
    expect(overflow.ok).toBe(false);
    expect(startGame(lobbyWith(RULES.maxPlayers), 1).ok).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    const a = started(4, 999);
    const b = started(4, 999);
    expect(a.drawPile.map((c) => c.type)).toEqual(b.drawPile.map((c) => c.type));
    // Seating is part of setup, so it's deterministic for a seed too.
    expect(a.players.map((p) => p.id)).toEqual(b.players.map((p) => p.id));
  });

  it('randomises the seating instead of using lobby join order', () => {
    const joinOrder = lobbyWith(4).players.map((p) => p.id);
    // The same players are seated for a game — just (usually) reordered.
    const s = started(4, 999);
    expect([...s.players.map((p) => p.id)].sort()).toEqual([...joinOrder].sort());
    // Across many seeds the start order is not always the lobby join order, and
    // it isn't fixed to one permutation either (a fresh shuffle per game).
    const orders = Array.from({ length: 25 }, (_, i) => started(4, i + 1).players.map((p) => p.id).join(','));
    expect(orders.some((o) => o !== joinOrder.join(','))).toBe(true);
    expect(new Set(orders).size).toBeGreaterThan(1);
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
    let state = startedUnlimitedAttack(3);
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

describe('Attack stacking limit (house rule)', () => {
  /** The current player plays an injected Attack and resolves it. */
  function attackOnce(state: GameState): GameState {
    const me = current(state).id;
    const inj = withCardInHand(state, me, CardType.Attack);
    const next = apply(inj.state, { type: 'play', playerId: me, cardIds: [inj.cardId] });
    return apply(next, { type: 'resolve_pending' });
  }

  const startWith = (n: number, opts: Parameters<typeof setOptions>[1]): GameState => {
    const r = startGame(setOptions(lobbyWith(n), opts), 123);
    if (!r.ok) throw new Error(r.error);
    return r.state;
  };

  it('caps chained Attacks at 2 by default (no stacking)', () => {
    let state = started(3); // default: limit on, max 2
    state = attackOnce(state); // fresh attack -> 2
    expect(state.turnsRemaining).toBe(2);
    state = attackOnce(state); // would stack to 4, capped to 2
    expect(state.turnsRemaining).toBe(2);
  });

  it('caps at the host-chosen maximum when raised', () => {
    let state = startWith(3, { maxAttackTurns: 4 });
    state = attackOnce(state);
    expect(state.turnsRemaining).toBe(2);
    state = attackOnce(state); // 2 + 2 = 4 (at cap)
    expect(state.turnsRemaining).toBe(4);
    state = attackOnce(state); // 4 + 2 = 6, capped to 4
    expect(state.turnsRemaining).toBe(4);
  });

  it('stacks without limit when the host turns the limit off', () => {
    let state = startedUnlimitedAttack(3);
    state = attackOnce(state);
    expect(state.turnsRemaining).toBe(2);
    state = attackOnce(state);
    expect(state.turnsRemaining).toBe(4);
  });
});

describe('Bounce-back Nope (reverse a resolved Attack/Skip on your turn)', () => {
  /** Play `type` to resolution from the current player; returns the new state. */
  function playToResolution(state: GameState, type: CardType): GameState {
    const me = current(state).id;
    const inj = withCardInHand(state, me, type);
    let next = apply(inj.state, { type: 'play', playerId: me, cardIds: [inj.cardId] });
    next = apply(next, { type: 'resolve_pending' });
    return next;
  }

  it('lets the attacked player Nope it at the start of their turn, bouncing the turn back', () => {
    let state = started(3);
    const attacker = current(state).id;
    state = playToResolution(state, CardType.Attack);

    const victim = current(state).id;
    expect(victim).not.toBe(attacker);
    expect(state.reversibleTurnPass?.victimId).toBe(victim);

    const nope = withCardInHand(state, victim, CardType.Nope);
    state = apply(nope.state, { type: 'nope', playerId: victim, cardId: nope.cardId });

    // Turn is back with the attacker, as a fresh single turn, attack cleared.
    expect(current(state).id).toBe(attacker);
    expect(state.turnsRemaining).toBe(1);
    expect(state.attacked).toBe(false);
    expect(state.reversibleTurnPass).toBeUndefined();
    // The Nope was spent.
    expect(player(state, victim).hand.some((c) => c.id === nope.cardId)).toBe(false);
    expect(state.discardPile.some((c) => c.id === nope.cardId)).toBe(true);
  });

  it('lets a Skipped-to player bounce a turn-passing Skip back', () => {
    let state = started(3);
    const skipper = current(state).id;
    state = playToResolution(state, CardType.Skip);

    const victim = current(state).id;
    expect(victim).not.toBe(skipper);
    const nope = withCardInHand(state, victim, CardType.Nope);
    state = apply(nope.state, { type: 'nope', playerId: victim, cardId: nope.cardId });

    expect(current(state).id).toBe(skipper);
    expect(state.turnsRemaining).toBe(1);
  });

  it('restores a stacked attacker exactly (still owing their turns)', () => {
    let state = startedUnlimitedAttack(3);
    state = playToResolution(state, CardType.Attack); // p1 now owes 2

    const p1 = current(state).id;
    expect(state.turnsRemaining).toBe(2);
    state = playToResolution(state, CardType.Attack); // p1 attacks onward -> p2 owes 4

    const p2 = current(state).id;
    expect(state.turnsRemaining).toBe(4);
    const nope = withCardInHand(state, p2, CardType.Nope);
    state = apply(nope.state, { type: 'nope', playerId: p2, cardId: nope.cardId });

    // p1 is restored exactly as before they attacked: owing 2, still attacked.
    expect(current(state).id).toBe(p1);
    expect(state.turnsRemaining).toBe(2);
    expect(state.attacked).toBe(true);
  });

  it('does not offer a bounce-back when a Skip only burns one of several stacked turns', () => {
    let state = started(3);
    state = playToResolution(state, CardType.Attack); // p1 owes 2

    const p1 = current(state).id;
    state = playToResolution(state, CardType.Skip); // burns one of p1's two turns
    // Same player is still up, so there is nothing to bounce.
    expect(current(state).id).toBe(p1);
    expect(state.turnsRemaining).toBe(1);
    expect(state.reversibleTurnPass).toBeUndefined();
  });

  it('locks the bounce-back once the victim draws', () => {
    let state = started(3);
    state = playToResolution(state, CardType.Attack);

    const victim = current(state).id;
    state = apply(state, { type: 'draw', playerId: victim });
    expect(state.reversibleTurnPass).toBeUndefined();

    const nope = withCardInHand(state, victim, CardType.Nope);
    const r = applyAction(nope.state, { type: 'nope', playerId: victim, cardId: nope.cardId });
    expect(r.ok).toBe(false);
  });

  it('locks the bounce-back once the victim plays a (non-reversing) card', () => {
    let state = started(3);
    state = playToResolution(state, CardType.Attack);

    const victim = current(state).id;
    const stf = withCardInHand(state, victim, CardType.SeeTheFuture);
    state = apply(stf.state, { type: 'play', playerId: victim, cardIds: [stf.cardId] });
    state = apply(state, { type: 'resolve_pending' });
    expect(state.reversibleTurnPass).toBeUndefined();
  });

  it('only the player it landed on may bounce it back', () => {
    let state = started(3);
    state = playToResolution(state, CardType.Attack);

    const victim = current(state).id;
    const bystander = state.players.find((p) => p.id !== victim && p.id !== state.reversibleTurnPass!.by)!.id;
    const nope = withCardInHand(state, bystander, CardType.Nope);
    const r = applyAction(nope.state, { type: 'nope', playerId: bystander, cardId: nope.cardId });
    expect(r.ok).toBe(false);
  });

  it('requires a Nope card to bounce back', () => {
    let state = started(3);
    state = playToResolution(state, CardType.Attack);
    const victim = current(state).id;
    const r = applyAction(state, { type: 'nope', playerId: victim, cardId: 'no-such-card' });
    expect(r.ok).toBe(false);
  });

  it('exposes reverseTurnPass in the view only to the player it landed on', () => {
    let state = started(3);
    state = playToResolution(state, CardType.Attack);
    const victim = current(state).id;
    const other = state.players.find((p) => p.id !== victim)!.id;

    const victimView = projectView(state, 'ABCDEF', victim, null);
    const otherView = projectView(state, 'ABCDEF', other, null);
    expect(victimView.reverseTurnPass?.kind).toBe(CardType.Attack);
    expect(otherView.reverseTurnPass).toBeNull();
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
  it('a pair opens a blind steal-pick, which steals once the thief picks', () => {
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
    // Resolving the pair does NOT steal yet — it opens the blind pick.
    expect(state.awaiting?.type).toBe('steal_pick');
    expect(player(state, target).hand.length).toBe(targetBefore);

    state = apply(state, { type: 'steal_pick', playerId: me, cardIndex: 0 });
    expect(state.awaiting).toBeUndefined();
    expect(player(state, target).hand.length).toBe(targetBefore - 1);
    // me: -2 cat cards + 1 stolen = mineBefore - 1
    expect(player(state, me).hand.length).toBe(mineBefore - 1);
  });

  it('the thief picks the card at the chosen index (faithful blind pick)', () => {
    let state = started(2);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    // Give the target a known, fixed hand so we can assert which card is taken.
    const known: Card[] = [
      { id: 'k0', type: CardType.Skip },
      { id: 'k1', type: CardType.Shuffle },
      { id: 'k2', type: CardType.Favor },
    ];
    state = { ...state, players: state.players.map((p) => (p.id === target ? { ...p, hand: known } : p)) };
    const a = withCardInHand(state, me, CardType.BeardCat);
    state = a.state;
    const b = withCardInHand(state, me, CardType.BeardCat);
    state = b.state;

    state = apply(state, { type: 'play', playerId: me, cardIds: [a.cardId, b.cardId], combo: 'pair', target });
    state = apply(state, { type: 'resolve_pending' });
    state = apply(state, { type: 'steal_pick', playerId: me, cardIndex: 1 });
    // Index 1 was the Shuffle ('k1').
    expect(player(state, me).hand.some((c) => c.id === 'k1')).toBe(true);
    expect(player(state, target).hand.some((c) => c.id === 'k1')).toBe(false);
  });

  it('only the thief may resolve a steal-pick', () => {
    let state = started(3);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    const a = withCardInHand(state, me, CardType.Tacocat);
    state = a.state;
    const b = withCardInHand(state, me, CardType.Tacocat);
    state = b.state;
    state = apply(state, { type: 'play', playerId: me, cardIds: [a.cardId, b.cardId], combo: 'pair', target });
    state = apply(state, { type: 'resolve_pending' });
    const r = applyAction(state, { type: 'steal_pick', playerId: target, cardIndex: 0 });
    expect(r.ok).toBe(false);
  });

  it('a pair against an empty-handed target fizzles with no steal-pick', () => {
    let state = started(2);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    state = { ...state, players: state.players.map((p) => (p.id === target ? { ...p, hand: [] } : p)) };
    const a = withCardInHand(state, me, CardType.Tacocat);
    state = a.state;
    const b = withCardInHand(state, me, CardType.Tacocat);
    state = b.state;
    state = apply(state, { type: 'play', playerId: me, cardIds: [a.cardId, b.cardId], combo: 'pair', target });
    state = apply(state, { type: 'resolve_pending' });
    expect(state.awaiting).toBeUndefined();
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

    const countShuffle = (s: GameState, id: string) =>
      player(s, id).hand.filter((c) => c.type === CardType.Shuffle).length;
    const meBefore = countShuffle(state, me);
    const targetBefore = countShuffle(state, target);

    state = apply(state, {
      type: 'play',
      playerId: me,
      cardIds: [c1.cardId, c2.cardId, c3.cardId],
      combo: 'triple',
      target,
      namedCard: CardType.Shuffle,
    });
    state = apply(state, { type: 'resolve_pending' });
    // A named Shuffle moved from the target into my hand.
    expect(countShuffle(state, me)).toBe(meBefore + 1);
    expect(countShuffle(state, target)).toBe(targetBefore - 1);
  });
});

describe('reorderHand', () => {
  it('reorders a player to an exact permutation of their hand', () => {
    const state = started(3);
    const me = current(state).id;
    const ids = player(state, me).hand.map((c) => c.id);
    const reversed = [...ids].reverse();
    const next = reorderHand(state, me, reversed);
    expect(next).not.toBeNull();
    expect(next!.players.find((p) => p.id === me)!.hand.map((c) => c.id)).toEqual(reversed);
  });

  it('rejects a non-permutation (wrong length, unknown or duplicate id)', () => {
    const state = started(3);
    const me = current(state).id;
    const ids = player(state, me).hand.map((c) => c.id);
    expect(reorderHand(state, me, ids.slice(1))).toBeNull(); // missing one
    expect(reorderHand(state, me, [...ids.slice(1), 'bogus'])).toBeNull(); // unknown id
    expect(reorderHand(state, me, [ids[0], ...ids.slice(0, ids.length - 1)])).toBeNull(); // duplicate
  });

  it('leaves other players untouched and does not bump version', () => {
    const state = started(3);
    const me = current(state).id;
    const other = state.players.find((p) => p.id !== me)!.id;
    const otherBefore = player(state, other).hand.map((c) => c.id);
    const next = reorderHand(state, me, [...player(state, me).hand.map((c) => c.id)].reverse())!;
    expect(next.players.find((p) => p.id === other)!.hand.map((c) => c.id)).toEqual(otherBefore);
    expect(next.version).toBe(state.version);
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

describe('regression: bug fixes', () => {
  it('Attack stacks correctly after the attacked player consumes a turn (owe 1 -> next owes 3)', () => {
    let state = startedUnlimitedAttack(3);
    const p0 = current(state).id;
    // p0 attacks -> p1 owes 2.
    let inj = withCardInHand(state, p0, CardType.Attack);
    state = inj.state;
    state = apply(state, { type: 'play', playerId: p0, cardIds: [inj.cardId] });
    state = apply(state, { type: 'resolve_pending' });
    const p1 = current(state).id;
    expect(state.turnsRemaining).toBe(2);

    // p1 takes one of the two turns by drawing a safe (non-EK) card.
    const safe: Card = { id: 'safe-top', type: CardType.Skip };
    state = { ...state, drawPile: [safe, ...state.drawPile] };
    state = apply(state, { type: 'draw', playerId: p1 });
    expect(current(state).id).toBe(p1); // still p1's turn
    expect(state.turnsRemaining).toBe(1); // one turn left, still attacked

    // p1 now attacks -> next player should owe 1 (remaining) + 2 = 3.
    inj = withCardInHand(state, p1, CardType.Attack);
    state = inj.state;
    state = apply(state, { type: 'play', playerId: p1, cardIds: [inj.cardId] });
    state = apply(state, { type: 'resolve_pending' });
    expect(current(state).id).not.toBe(p1);
    expect(state.turnsRemaining).toBe(3);
  });

  it('a non-attacked Attack always passes exactly 2 (not 3)', () => {
    let state = started(3);
    const me = current(state).id;
    const inj = withCardInHand(state, me, CardType.Attack);
    state = inj.state;
    state = apply(state, { type: 'play', playerId: me, cardIds: [inj.cardId] });
    state = apply(state, { type: 'resolve_pending' });
    expect(state.turnsRemaining).toBe(2);
  });

  it('the actor cannot Nope their own action while it is set to resolve', () => {
    let state = started(3);
    const me = current(state).id;
    const skip = withCardInHand(state, me, CardType.Skip);
    state = skip.state;
    const myNope = withCardInHand(state, me, CardType.Nope);
    state = myNope.state;
    state = apply(state, { type: 'play', playerId: me, cardIds: [skip.cardId] });
    const r = applyAction(state, { type: 'nope', playerId: me, cardId: myNope.cardId });
    expect(r.ok).toBe(false);
  });

  it('a combo containing an Exploding Kitten is rejected', () => {
    let state = started(3);
    const me = current(state).id;
    const ek: Card = { id: 'combo-ek', type: CardType.ExplodingKitten };
    const cat = withCardInHand(state, me, CardType.Tacocat);
    state = cat.state;
    state = { ...state, players: state.players.map((p) => (p.id === me ? { ...p, hand: [...p.hand, ek] } : p)) };
    const r = applyAction(state, { type: 'play', playerId: me, cardIds: [cat.cardId, 'combo-ek'], combo: 'pair' });
    expect(r.ok).toBe(false);
  });

  it('a triple that names a card the target lacks emits no "stole" event', () => {
    let state = started(3);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    // Ensure the target does NOT hold a Shuffle.
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === target ? { ...p, hand: p.hand.filter((c) => c.type !== CardType.Shuffle) } : p,
      ),
    };
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
    const r = applyAction(state, { type: 'resolve_pending' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.events.some((e) => e.type === 'stole')).toBe(false);
  });

  it('a server-provided rng seed makes Shuffle order independent of version', () => {
    let state = started(4, 42);
    const me = current(state).id;
    const inj = withCardInHand(state, me, CardType.Shuffle);
    state = inj.state;
    const afterPlay = apply(state, { type: 'play', playerId: me, cardIds: [inj.cardId] });
    const a = applyAction(afterPlay, { type: 'resolve_pending' }, { rngSeed: 111 });
    const b = applyAction(afterPlay, { type: 'resolve_pending' }, { rngSeed: 222 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      // Different seeds -> (almost certainly) different orders; same seed -> same order.
      const c = applyAction(afterPlay, { type: 'resolve_pending' }, { rngSeed: 111 });
      expect(c.ok).toBe(true);
      if (c.ok) expect(a.state.drawPile.map((x) => x.id)).toEqual(c.state.drawPile.map((x) => x.id));
      expect(a.state.drawPile.map((x) => x.id)).not.toEqual(b.state.drawPile.map((x) => x.id));
    }
  });
});

describe('canRespondToPending (Nope window stays open for a Yup)', () => {
  function withPendingSkip(n = 3) {
    let state = started(n);
    const me = current(state).id;
    const skip = withCardInHand(state, me, CardType.Skip);
    state = skip.state;
    state = apply(state, { type: 'play', playerId: me, cardIds: [skip.cardId] });
    return { state, me };
  }

  /** Remove every Nope from every hand so each test controls who holds one. */
  function stripNopes(state: GameState): GameState {
    return {
      ...state,
      players: state.players.map((p) => ({ ...p, hand: p.hand.filter((c) => c.type !== CardType.Nope) })),
    };
  }

  it('returns false when nothing is pending', () => {
    expect(canRespondToPending(started(3))).toBe(false);
  });

  it('is true while an opponent holds a Nope', () => {
    let { state, me } = withPendingSkip(3);
    const other = state.players.find((p) => p.id !== me)!.id;
    const nope = withCardInHand(stripNopes(state), other, CardType.Nope);
    expect(canRespondToPending(nope.state)).toBe(true);
  });

  it('is false when only the actor holds a Nope and the action is NOT cancelled (even count)', () => {
    let { state, me } = withPendingSkip(3);
    const mine = withCardInHand(stripNopes(state), me, CardType.Nope);
    expect(mine.state.pending!.nopes).toBe(0);
    // You cannot Nope your own uncancelled action, and nobody else holds one.
    expect(canRespondToPending(mine.state)).toBe(false);
  });

  it('is true when the actor holds a Nope and the action IS cancelled (odd count) — they may Yup', () => {
    let { state, me } = withPendingSkip(3);
    const other = state.players.find((p) => p.id !== me)!.id;
    state = stripNopes(state);
    const opp = withCardInHand(state, other, CardType.Nope);
    state = opp.state;
    const mine = withCardInHand(state, me, CardType.Nope);
    state = mine.state;
    // Opponent casts their only Nope → odd count; now ONLY the actor holds one.
    state = apply(state, { type: 'nope', playerId: other, cardId: opp.cardId });
    expect(state.pending!.nopes).toBe(1);
    expect(player(state, other).hand.some((c) => c.type === CardType.Nope)).toBe(false);
    // Regression: the actor must still be allowed to respond (a "Yup").
    expect(canRespondToPending(state)).toBe(true);
  });

  it('ignores disconnected or eliminated Nope holders', () => {
    let { state, me } = withPendingSkip(3);
    const other = state.players.find((p) => p.id !== me)!.id;
    const base = withCardInHand(stripNopes(state), other, CardType.Nope).state;
    expect(canRespondToPending(base)).toBe(true);
    const disconnected = { ...base, players: base.players.map((p) => (p.id === other ? { ...p, connected: false } : p)) };
    expect(canRespondToPending(disconnected)).toBe(false);
    const dead = { ...base, players: base.players.map((p) => (p.id === other ? { ...p, alive: false } : p)) };
    expect(canRespondToPending(dead)).toBe(false);
  });
});

describe('combo fidelity guards', () => {
  const FIVE_DIFFERENT = [
    CardType.Skip,
    CardType.Attack,
    CardType.Favor,
    CardType.Shuffle,
    CardType.SeeTheFuture,
  ];

  /** Give the current player five distinct non-cat cards for a five-different play. */
  function withFiveDifferent(state: GameState, me: string): { state: GameState; ids: string[] } {
    const ids: string[] = [];
    for (const t of FIVE_DIFFERENT) {
      const inj = withCardInHand(state, me, t);
      state = inj.state;
      ids.push(inj.cardId);
    }
    return { state, ids };
  }

  it('rejects a five-different that tries to take an Exploding Kitten from the discard', () => {
    let state = started(3);
    const me = current(state).id;
    const ek: Card = { id: 'disc-ek', type: CardType.ExplodingKitten };
    state = { ...state, discardPile: [...state.discardPile, ek] };
    const five = withFiveDifferent(state, me);
    const r = applyAction(five.state, {
      type: 'play',
      playerId: me,
      cardIds: five.ids,
      combo: 'five_different',
      discardCardId: 'disc-ek',
    });
    expect(r.ok).toBe(false);
  });

  it('still allows taking a normal card (e.g. a Defuse) from the discard via five-different', () => {
    let state = started(3);
    const me = current(state).id;
    const def: Card = { id: 'disc-def', type: CardType.Defuse };
    state = { ...state, discardPile: [...state.discardPile, def] };
    const five = withFiveDifferent(state, me);
    const r = applyAction(five.state, {
      type: 'play',
      playerId: me,
      cardIds: five.ids,
      combo: 'five_different',
      discardCardId: 'disc-def',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a triple that names the Exploding Kitten', () => {
    let state = started(3);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    const c1 = withCardInHand(state, me, CardType.BeardCat);
    state = c1.state;
    const c2 = withCardInHand(state, me, CardType.BeardCat);
    state = c2.state;
    const c3 = withCardInHand(state, me, CardType.BeardCat);
    state = c3.state;
    const r = applyAction(state, {
      type: 'play',
      playerId: me,
      cardIds: [c1.cardId, c2.cardId, c3.cardId],
      combo: 'triple',
      target,
      namedCard: CardType.ExplodingKitten,
    });
    expect(r.ok).toBe(false);
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

describe('house rules (options)', () => {
  it('defaults every combo to enabled, attack-stacking capped at 2, and the cats theme', () => {
    const lobby = createLobby('p0');
    expect(lobby.options).toEqual({
      allowPairSteal: true,
      allowTripleDemand: true,
      allowFiveDifferent: true,
      limitAttackStacking: true,
      maxAttackTurns: MIN_ATTACK_TURNS,
      theme: 'cats',
    });
  });

  it('lets the lobby switch theme and carries it into the started game', () => {
    let state = setOptions(lobbyWith(3), { theme: 'dogs' });
    expect(state.options.theme).toBe('dogs');
    expect(state.options.allowPairSteal).toBe(true); // combos untouched
    const r = startGame(state, 7);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.options.theme).toBe('dogs');
  });

  it('lets the lobby toggle a rule off and carries it into the started game', () => {
    let state = lobbyWith(3);
    state = setOptions(state, { allowFiveDifferent: false });
    expect(state.options.allowFiveDifferent).toBe(false);
    expect(state.options.allowPairSteal).toBe(true); // others untouched
    const r = startGame(state, 7);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.options.allowFiveDifferent).toBe(false);
  });

  it('clamps maxAttackTurns to the allowed bounds', () => {
    expect(setOptions(lobbyWith(3), { maxAttackTurns: 0 }).options.maxAttackTurns).toBe(MIN_ATTACK_TURNS);
    expect(setOptions(lobbyWith(3), { maxAttackTurns: 999 }).options.maxAttackTurns).toBe(MAX_ATTACK_TURNS);
    expect(setOptions(lobbyWith(3), { maxAttackTurns: 5 }).options.maxAttackTurns).toBe(5);
  });

  it('ignores option changes once the game is in progress', () => {
    const started3 = started(3);
    const after = setOptions(started3, { allowPairSteal: false });
    expect(after.options.allowPairSteal).toBe(true);
    expect(after).toBe(started3); // unchanged reference
  });

  it('rejects a disabled five-different combo', () => {
    const lobby = setOptions(lobbyWith(3), { allowFiveDifferent: false });
    const r0 = startGame(lobby, 7);
    if (!r0.ok) throw new Error(r0.error);
    const state = r0.state;
    const me = current(state).id;
    const five = withFiveDifferentCards(state, me);
    const r = applyAction(five.state, {
      type: 'play',
      playerId: me,
      cardIds: five.ids,
      combo: 'five_different',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a disabled pair, but still allows it when enabled', () => {
    const lobby = lobbyWith(3);
    // Disabled:
    const offRes = startGame(setOptions(lobby, { allowPairSteal: false }), 7);
    if (!offRes.ok) throw new Error(offRes.error);
    let off = offRes.state;
    const meOff = current(off).id;
    const targetOff = off.players.find((p) => p.id !== meOff)!.id;
    let a = withCardInHand(off, meOff, CardType.Tacocat);
    off = a.state;
    let b = withCardInHand(off, meOff, CardType.Tacocat);
    off = b.state;
    const rOff = applyAction(off, {
      type: 'play',
      playerId: meOff,
      cardIds: [a.cardId, b.cardId],
      combo: 'pair',
      target: targetOff,
    });
    expect(rOff.ok).toBe(false);

    // Enabled (default):
    const onRes = startGame(lobby, 7);
    if (!onRes.ok) throw new Error(onRes.error);
    let on = onRes.state;
    const meOn = current(on).id;
    const targetOn = on.players.find((p) => p.id !== meOn)!.id;
    a = withCardInHand(on, meOn, CardType.Cattermelon);
    on = a.state;
    b = withCardInHand(on, meOn, CardType.Cattermelon);
    on = b.state;
    const rOn = applyAction(on, {
      type: 'play',
      playerId: meOn,
      cardIds: [a.cardId, b.cardId],
      combo: 'pair',
      target: targetOn,
    });
    expect(rOn.ok).toBe(true);
  });
});

describe('play again (reset to lobby)', () => {
  it('returns a finished game to the lobby, keeping players, host, and options', () => {
    const seeded = setOptions(lobbyWith(3), { theme: 'dogs', allowPairSteal: false });
    const r = startGame(seeded, 7);
    if (!r.ok) throw new Error(r.error);
    // Force a finished game, then reset.
    const finished: GameState = { ...r.state, phase: 'gameOver', winnerId: r.state.players[0].id };
    const lobby = resetToLobby(finished);

    expect(lobby.phase).toBe('lobby');
    expect(lobby.winnerId).toBeUndefined();
    expect(lobby.hostId).toBe(finished.hostId);
    expect(lobby.players.map((p) => p.id).sort()).toEqual(finished.players.map((p) => p.id).sort());
    // House rules carry over.
    expect(lobby.options.theme).toBe('dogs');
    expect(lobby.options.allowPairSteal).toBe(false);
    // Per-player game state is cleared and players are not-ready.
    for (const p of lobby.players) {
      expect(p.hand).toHaveLength(0);
      expect(p.alive).toBe(true);
      expect(p.ready).toBe(false);
    }
    // The same group can immediately start again.
    expect(startGame(lobby, 8).ok).toBe(true);
  });
});

describe('Nope chains', () => {
  /** Current player plays an injected single-action card (no resolve yet). */
  function play(state: GameState, type: CardType): GameState {
    const me = current(state).id;
    const inj = withCardInHand(state, me, type);
    return apply(inj.state, { type: 'play', playerId: me, cardIds: [inj.cardId] });
  }
  /** `pid` plays an injected Nope on the open pending action. */
  function nope(state: GameState, pid: string): GameState {
    const inj = withCardInHand(state, pid, CardType.Nope);
    return apply(inj.state, { type: 'nope', playerId: pid, cardId: inj.cardId });
  }

  it('chains Skip -> Nope -> Attack -> Nope, leaving the original player on their turn', () => {
    let state = started(3);
    const me = current(state).id;
    const opp = state.players.find((p) => p.id !== me)!.id;

    // Skip, Noped -> cancelled; the turn never passes.
    state = play(state, CardType.Skip);
    state = nope(state, opp);
    expect(state.pending?.nopes).toBe(1);
    state = apply(state, { type: 'resolve_pending' });
    expect(current(state).id).toBe(me);
    expect(state.turnsRemaining).toBe(1);

    // Attack, Noped -> cancelled; still the same player's single turn.
    state = play(state, CardType.Attack);
    state = nope(state, opp);
    state = apply(state, { type: 'resolve_pending' });
    expect(current(state).id).toBe(me);
    expect(state.turnsRemaining).toBe(1);
  });

  it('lets a Nope be Noped (a Yup), re-enabling the original action', () => {
    let state = started(3);
    const me = current(state).id;
    const opp = state.players.find((p) => p.id !== me)!.id;

    state = play(state, CardType.Skip);
    state = nope(state, opp); // nopes = 1 -> would cancel
    expect(state.pending?.nopes).toBe(1);
    state = nope(state, me); // a Yup: nopes = 2 -> resolves after all
    expect(state.pending?.nopes).toBe(2);
    state = apply(state, { type: 'resolve_pending' });
    // Skip stood: the turn passed to the next player.
    expect(current(state).id).not.toBe(me);
  });
});

/** Give the current player five distinct non-cat cards (top-level helper). */
function withFiveDifferentCards(state: GameState, me: string): { state: GameState; ids: string[] } {
  const types = [
    CardType.Attack,
    CardType.Skip,
    CardType.Favor,
    CardType.Shuffle,
    CardType.SeeTheFuture,
  ];
  const ids: string[] = [];
  for (const t of types) {
    const inj = withCardInHand(state, me, t);
    state = inj.state;
    ids.push(inj.cardId);
  }
  return { state, ids };
}

describe('spectator view', () => {
  it('reveals every hand and the full draw pile, with no seat', () => {
    const state = started(3);
    const view = projectSpectatorView(state, 'ABCDEF', null);
    expect(view.isSpectator).toBe(true);
    expect(view.yourHand).toEqual([]); // a spectator holds no cards
    expect(view.spectator).not.toBeNull();
    // Every player's full hand is exposed, matching the authoritative state.
    expect(view.spectator!.hands.map((h) => h.playerId).sort()).toEqual(
      state.players.map((p) => p.id).sort(),
    );
    for (const p of state.players) {
      const revealed = view.spectator!.hands.find((h) => h.playerId === p.id)!.cards;
      expect(revealed.map((c) => c.id)).toEqual(p.hand.map((c) => c.id));
    }
    // The entire draw-pile order is revealed.
    expect(view.spectator!.drawPile.map((c) => c.id)).toEqual(state.drawPile.map((c) => c.id));
    // Defaults to the explicit "watching" reason when none is given.
    expect(view.spectator!.reason).toBe('watching');
  });

  it('carries the reason it was given (e.g. an eliminated player)', () => {
    const state = started(3);
    const view = projectSpectatorView(state, 'ABCDEF', null, null, 'eliminated');
    expect(view.spectator!.reason).toBe('eliminated');
  });

  it('keeps the eliminated player\'s seat id so a knocked-out host can restart', () => {
    const state = started(3);
    const host = state.players.find((p) => p.id === state.hostId)!;
    host.alive = false;
    host.hand = []; // exploding clears the hand
    const view = projectSpectatorView(state, 'ABCDEF', null, null, 'eliminated', host.id);
    // The view knows who they are, so the client can offer "Play again" to a host.
    expect(view.youId).toBe(host.id);
    expect(view.youId).toBe(view.hostId);
    expect(view.yourHand).toEqual([]); // still no leak of a hand they no longer hold
    // The full reveal is unchanged.
    expect(view.spectator!.hands.length).toBe(state.players.length);
  });

  it('a normal player view never carries spectator data', () => {
    const state = started(3);
    const view = projectView(state, 'ABCDEF', state.players[0].id, null);
    expect(view.isSpectator).toBe(false);
    expect(view.spectator).toBeNull();
  });

  it('an eliminated player watches as a spectator while the game is in progress', () => {
    const state = started(3);
    const dead = state.players[0].id;
    expect(shouldSpectate(state, dead)).toBe(false); // still alive
    state.players[0].alive = false;
    expect(shouldSpectate(state, dead)).toBe(true); // exploded mid-game
    // Living players, and unknown ids, never get the spectator view.
    expect(shouldSpectate(state, state.players[1].id)).toBe(false);
    expect(shouldSpectate(state, 'nobody')).toBe(false);
  });

  it('keeps spectating a dead player on the game-over screen', () => {
    const state = started(3);
    state.players[0].alive = false;
    state.phase = 'gameOver';
    state.winnerId = state.players[1].id;
    // The player whose explosion ended the game (and any 2-player loser) still
    // gets the full reveal at game over, rather than an empty view.
    expect(shouldSpectate(state, state.players[0].id)).toBe(true);
    // The surviving winner is not a spectator — they get the normal win screen.
    expect(shouldSpectate(state, state.players[1].id)).toBe(false);
  });

  it('stops spectating once the room returns to the lobby', () => {
    const state = started(3);
    state.players[0].alive = false;
    state.phase = 'lobby';
    // A new game deals everyone back in as normal players.
    expect(shouldSpectate(state, state.players[0].id)).toBe(false);
  });
});

describe('draw reveal redaction', () => {
  it('attaches the drawn card for the drawer but strips it for everyone else', () => {
    let state = started(3);
    const me = current(state).id;
    const other = state.players.find((p) => p.id !== me)!.id;
    // Ensure the top card is an ordinary card (not an Exploding Kitten).
    const top: Card = { id: 'draw-top', type: CardType.Skip };
    state = { ...state, drawPile: [top, ...state.drawPile] };

    const r = applyAction(state, { type: 'draw', playerId: me });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const drawn = r.events.find((e) => e.type === 'card_drawn');
    expect(drawn && drawn.type === 'card_drawn' && drawn.card?.id).toBe('draw-top');

    const forDrawer = redactEventForRecipient(drawn!, me);
    const forOther = redactEventForRecipient(drawn!, other);
    expect(forDrawer.type === 'card_drawn' && forDrawer.card?.id).toBe('draw-top');
    expect(forOther.type === 'card_drawn' && forOther.card).toBeUndefined();
  });

  it('never attaches a card when an Exploding Kitten is drawn', () => {
    let state = started(3);
    const me = current(state).id;
    const ek: Card = { id: 'ek-top', type: CardType.ExplodingKitten };
    state = { ...state, drawPile: [ek, ...state.drawPile] };
    const r = applyAction(state, { type: 'draw', playerId: me });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const drawn = r.events.find((e) => e.type === 'card_drawn');
    expect(drawn && drawn.type === 'card_drawn' && drawn.card).toBeUndefined();
  });
});

describe('security: hidden-information redaction', () => {
  it("does not leak the drawn Exploding Kitten into others' views during a defuse", () => {
    let state = started(3);
    const me = current(state).id;
    const other = state.players.find((p) => p.id !== me)!.id;
    const ek: Card = { id: 'ek-secret', type: CardType.ExplodingKitten };
    state = { ...state, drawPile: [ek, ...state.drawPile] };
    state = apply(state, { type: 'draw', playerId: me });
    expect(state.awaiting?.type).toBe('defuse_or_explode');

    // The kitten is held off-pile, so it never appears on the public discard.
    expect(state.discardPile.some((c) => c.id === 'ek-secret')).toBe(false);
    const view = projectView(state, 'ABCDEF', other, null);
    expect(view.discardPile.some((c) => c.id === 'ek-secret')).toBe(false);
    expect(view.discardTop?.id).not.toBe('ek-secret');
    // The opponent is not shown the defuse prompt (that's only for the drawer).
    expect(view.prompt).toBeNull();
  });

  it('reveals a stolen card only to the thief and the victim', () => {
    let state = started(3);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    const other = state.players.find((p) => p.id !== me && p.id !== target)!.id;
    const a = withCardInHand(state, me, CardType.Tacocat);
    state = a.state;
    const b = withCardInHand(state, me, CardType.Tacocat);
    state = b.state;
    state = apply(state, { type: 'play', playerId: me, cardIds: [a.cardId, b.cardId], combo: 'pair', target });
    state = apply(state, { type: 'resolve_pending' });
    const r = applyAction(state, { type: 'steal_pick', playerId: me, cardIndex: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stole = r.events.find((e) => e.type === 'stole');
    expect(stole && stole.type === 'stole' && stole.card).toBeDefined();

    // Thief and victim keep the card; a bystander has it stripped.
    const forThief = redactEventForRecipient(stole!, me);
    const forVictim = redactEventForRecipient(stole!, target);
    const forOther = redactEventForRecipient(stole!, other);
    expect(forThief.type === 'stole' && forThief.card).toBeDefined();
    expect(forVictim.type === 'stole' && forVictim.card).toBeDefined();
    expect(forOther.type === 'stole' && forOther.card).toBeUndefined();
  });
});

describe('avatars', () => {
  it('assigns distinct default avatars to the first players to join', () => {
    const state = lobbyWith(3);
    const avatars = state.players.map((p) => p.avatar);
    expect(avatars.every((a) => typeof a === 'string' && a.length > 0)).toBe(true);
    expect(new Set(avatars).size).toBe(3); // first 3 join slots are distinct
  });

  it('exposes each player avatar in the projected view', () => {
    const state = started(2);
    const view = projectView(state, 'ABCDEF', state.players[0].id, null);
    expect(view.players.map((p) => p.avatar)).toEqual(state.players.map((p) => p.avatar));
  });
});

describe('targeted actions surface the target', () => {
  it('includes the target on the cards_played event and the Nope view', () => {
    let state = started(3);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    const f = withCardInHand(state, me, CardType.Favor);
    const r = applyAction(f.state, { type: 'play', playerId: me, cardIds: [f.cardId], target });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const played = r.events.find((e) => e.type === 'cards_played');
    expect(played && played.type === 'cards_played' && played.target).toBe(target);

    // The pending action's target is exposed (redacted-safely) on the Nope view.
    const view = projectView(r.state, 'ABCDEF', target, Date.now() + 4000);
    expect(view.nope?.target).toBe(target);
  });
});

describe('blind-steal grace window (view)', () => {
  it('threads the thief pickableAt deadline into the steal view', () => {
    let state = started(3);
    const me = current(state).id;
    const target = state.players.find((p) => p.id !== me)!.id;
    const a = withCardInHand(state, me, CardType.BeardCat);
    const b = withCardInHand(a.state, me, CardType.BeardCat);
    state = apply(b.state, {
      type: 'play',
      playerId: me,
      cardIds: [a.cardId, b.cardId],
      combo: 'pair',
      target,
    });
    state = apply(state, { type: 'resolve_pending' });
    expect(state.awaiting?.type).toBe('steal_pick');
    const pickableAt = 10_000;
    const view = projectView(state, 'ABCDEF', target, null, pickableAt);
    expect(view.stealPick).toEqual({ by: me, from: target, pickableAt });
  });
});
