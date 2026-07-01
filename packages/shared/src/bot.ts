/**
 * Heuristic bot brains for Exploding Kittens.
 *
 * The single rule that keeps bots honest: {@link decideBotMove} is given ONLY a
 * {@link ClientGameView} — the exact redacted projection a human's browser
 * receives. It can read the bot's own hand and everything public (discard pile,
 * draw-pile *count*, who's alive, whose turn it is, a pending action's target),
 * but it can never see the draw-pile order or another player's hand. A bot
 * therefore cannot peek at the deck or anyone's cards; it plays on the same
 * information a fair human has. The function returns the same
 * {@link ClientMessage} a human client would send, so bots flow through the very
 * same validation and engine path.
 */

import { CardType, isCatCard, type Card } from './cards.js';
import type { ClientGameView, ClientMessage, PublicPlayer } from './protocol.js';
import type { BotDifficulty } from './state.js';

/** A source of randomness in [0, 1). Injected so bot play is deterministic in tests. */
export type Rand = () => number;

/**
 * How long a bot "thinks" before acting, in ms. A short, human-readable beat so
 * the table can follow what happened; harder bots take a touch longer.
 */
export function botThinkMs(difficulty: BotDifficulty, rand: Rand): number {
  const base = difficulty === 'hard' ? 1300 : difficulty === 'medium' ? 1000 : 750;
  return base + Math.floor(rand() * 500);
}

function pick<T>(arr: readonly T[], rand: Rand): T | undefined {
  return arr.length ? arr[Math.floor(rand() * arr.length)] : undefined;
}

/** How much a bot wants to KEEP a card (higher = keep). Used to choose what to shed. */
function keepValue(type: CardType): number {
  switch (type) {
    case CardType.Defuse:
      return 100;
    case CardType.Nope:
      return 45;
    case CardType.Attack:
      return 38;
    case CardType.Skip:
      return 32;
    case CardType.Favor:
      return 22;
    case CardType.SeeTheFuture:
      return 16;
    case CardType.Shuffle:
      return 12;
    default:
      return isCatCard(type) ? 6 : 10; // cat cards are only useful in combos
  }
}

function firstOfType(hand: Card[], type: CardType): Card | undefined {
  return hand.find((c) => c.type === type);
}

function countOfType(hand: Card[], type: CardType): number {
  return hand.reduce((n, c) => (c.type === type ? n + 1 : n), 0);
}

/** Living opponents (not me), richest hand first — a natural target preference. */
function opponents(view: ClientGameView): PublicPlayer[] {
  return view.players
    .filter((p) => p.alive && p.id !== view.youId)
    .sort((a, b) => b.handCount - a.handCount);
}

/**
 * Estimate the chance the next draw is an Exploding Kitten, from PUBLIC info only.
 * Every game seeds (initial seats − 1) kittens; each explosion sends one to the
 * (visible) discard pile, and a kitten only ever sits in the draw pile or the
 * discard (you can't hold one). So kittens still live = total − discarded, and
 * the per-draw risk is that over the known draw-pile size.
 */
function explodeRisk(view: ClientGameView): number {
  if (view.drawPileCount <= 0) return 0;
  const totalKittens = Math.max(0, view.players.length - 1);
  const discarded = view.discardPile.filter((c) => c.type === CardType.ExplodingKitten).length;
  const live = Math.max(0, totalKittens - discarded);
  return Math.min(1, live / view.drawPileCount);
}

/** Find a pair (2 identical) to play, preferring cat cards then the lowest-keep type. */
function findPair(hand: Card[]): Card[] | null {
  const byType = new Map<CardType, Card[]>();
  for (const c of hand) {
    if (c.type === CardType.ExplodingKitten || c.type === CardType.Defuse) continue;
    const arr = byType.get(c.type) ?? [];
    arr.push(c);
    byType.set(c.type, arr);
  }
  const pairs = [...byType.values()].filter((cs) => cs.length >= 2);
  if (!pairs.length) return null;
  pairs.sort((a, b) => keepValue(a[0].type) - keepValue(b[0].type));
  return pairs[0].slice(0, 2);
}

/** Build the message a bot would send on its own turn (play a card or draw). */
function decideTurn(view: ClientGameView, difficulty: BotDifficulty, rand: Rand): ClientMessage {
  const hand = view.yourHand;
  const draw: ClientMessage = { t: 'draw' };
  const foes = opponents(view);
  const risk = explodeRisk(view);
  const hasDefuse = countOfType(hand, CardType.Defuse) > 0;

  const skip = firstOfType(hand, CardType.Skip);
  const attack = firstOfType(hand, CardType.Attack);
  const shuffle = firstOfType(hand, CardType.Shuffle);
  const favor = firstOfType(hand, CardType.Favor);
  const see = firstOfType(hand, CardType.SeeTheFuture);

  // Easy: nearly random, but always legal and never suicidal. Usually just draws;
  // now and then it throws out a single utility card.
  if (difficulty === 'easy') {
    const utility = [skip, attack, shuffle, see, favor].filter(Boolean) as Card[];
    if (utility.length && rand() < 0.35) {
      const card = pick(utility, rand)!;
      if (card.type === CardType.Favor && foes.length) {
        return { t: 'play', cardIds: [card.id], target: pick(foes, rand)!.id };
      }
      if (card.type !== CardType.Favor) return { t: 'play', cardIds: [card.id] };
    }
    return draw;
  }

  // Medium / hard share a risk-aware spine; hard also uses combos and odds harder.
  const dangerous = risk >= (difficulty === 'hard' ? 0.34 : 0.5);

  // When a draw is likely to kill us and we hold no Defuse, dodge it.
  if (dangerous && !hasDefuse) {
    if (skip) return { t: 'play', cardIds: [skip.id] };
    if (attack && foes.length) return { t: 'play', cardIds: [attack.id] };
    if (shuffle) return { t: 'play', cardIds: [shuffle.id] }; // re-randomise the top
  }

  if (difficulty === 'hard') {
    // Three of a kind: name a card we lack and try to pull it from the richest foe.
    if (view.options.allowTripleDemand && foes.length) {
      const byType = new Map<CardType, Card[]>();
      for (const c of hand) {
        if (c.type === CardType.ExplodingKitten || c.type === CardType.Defuse) continue;
        const arr = byType.get(c.type) ?? [];
        arr.push(c);
        byType.set(c.type, arr);
      }
      const triple = [...byType.values()].find((cs) => cs.length >= 3);
      if (triple) {
        const want = hasDefuse ? CardType.Nope : CardType.Defuse;
        return { t: 'play', cardIds: triple.slice(0, 3).map((c) => c.id), combo: 'triple', target: foes[0].id, namedCard: want };
      }
    }
    // Five different from the discard: fish a Defuse out if we have none.
    if (view.options.allowFiveDifferent && !hasDefuse) {
      const distinct = new Map<CardType, Card>();
      for (const c of hand) {
        if (c.type === CardType.ExplodingKitten || c.type === CardType.Defuse) continue;
        if (!distinct.has(c.type)) distinct.set(c.type, c);
      }
      const defuseInDiscard = view.discardPile.find((c) => c.type === CardType.Defuse);
      if (distinct.size >= 5 && defuseInDiscard) {
        const five = [...distinct.values()].slice(0, 5).map((c) => c.id);
        return { t: 'play', cardIds: five, combo: 'five_different', discardCardId: defuseInDiscard.id };
      }
    }
    // A pair blind-steals a random card — worth it against a foe holding several.
    if (view.options.allowPairSteal && foes.length && foes[0].handCount >= 2) {
      const pair = findPair(hand);
      if (pair) return { t: 'play', cardIds: pair.map((c) => c.id), combo: 'pair', target: foes[0].id };
    }
  }

  // Medium: occasionally grab a card via Favor / a pair from the richest foe.
  if (difficulty === 'medium' && foes.length && rand() < 0.3) {
    if (favor) return { t: 'play', cardIds: [favor.id], target: foes[0].id };
    if (view.options.allowPairSteal && foes[0].handCount >= 1) {
      const pair = findPair(hand);
      if (pair) return { t: 'play', cardIds: pair.map((c) => c.id), combo: 'pair', target: foes[0].id };
    }
  }

  // Nothing strategic to do: end the turn by drawing.
  return draw;
}

/**
 * Decide what a bot should do for its current view, or null to wait (it isn't
 * the bot's move yet, or it chooses not to react to a pending action).
 */
export function decideBotMove(view: ClientGameView, difficulty: BotDifficulty, rand: Rand): ClientMessage | null {
  if (view.phase !== 'playing') return null;
  const hand = view.yourHand;

  // Forced choice aimed at us: defuse the kitten we just drew.
  if (view.prompt?.type === 'defuse_or_explode') {
    const defuse = firstOfType(hand, CardType.Defuse);
    if (!defuse) return null; // shouldn't happen (the prompt only fires when held)
    let insertPosition = Math.floor(rand() * (view.drawPileCount + 1));
    if (difficulty !== 'easy') {
      // Owe more turns? Bury it so we don't redraw it. Otherwise drop it on top to
      // hand the kitten straight to the next player.
      insertPosition = view.turnsRemaining > 1 ? view.drawPileCount : 0;
    }
    return { t: 'defuse', cardId: defuse.id, insertPosition };
  }

  // Forced choice aimed at us: give a card for a Favor. Shed the least useful.
  if (view.prompt?.type === 'favor_give') {
    if (!hand.length) return null;
    const give =
      difficulty === 'easy'
        ? pick(hand, rand)!
        : [...hand].sort((a, b) => keepValue(a.type) - keepValue(b.type))[0];
    return { t: 'give_favor_card', cardId: give.id };
  }

  // Our blind steal to make: the pick is genuinely blind, so it's random for all
  // tiers (there is no fair information to exploit). Wait until the victim's
  // rearrange grace has elapsed so the server won't reject an early pick.
  if (view.stealPick && view.stealPick.by === view.youId) {
    if (view.stealPick.pickableAt && Date.now() < view.stealPick.pickableAt) return null;
    const victim = view.players.find((p) => p.id === view.stealPick!.from);
    const n = Math.max(1, victim?.handCount ?? 1);
    return { t: 'steal_pick', cardIndex: Math.floor(rand() * n) };
  }

  // A resolved Attack/Skip just landed on us: a hard bot with a Nope bounces a
  // multi-turn Attack back rather than serve all those turns.
  if (view.reverseTurnPass && difficulty === 'hard' && view.turnsRemaining > 1) {
    const nope = firstOfType(hand, CardType.Nope);
    if (nope) return { t: 'nope', cardId: nope.id };
  }

  // An action is in its Nope window. We only ever choose to Nope something aimed
  // at us (medium/hard); we never Nope our own pending action.
  if (view.nope) {
    if (view.nope.by === view.youId) return null;
    if (difficulty === 'easy') return null;
    const nope = firstOfType(hand, CardType.Nope);
    if (!nope) return null;
    const aimedAtMe = view.nope.target === view.youId;
    // Hard also swats an incoming Attack (it changes whose turn it is, often onto us).
    const swatAttack = difficulty === 'hard' && view.nope.kind === CardType.Attack;
    if (aimedAtMe || swatAttack) return { t: 'nope', cardId: nope.id };
    return null;
  }

  // Our turn to play or draw.
  if (view.currentPlayerId === view.youId) {
    return decideTurn(view, difficulty, rand);
  }

  return null;
}
