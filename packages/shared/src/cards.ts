/**
 * Card definitions and deck composition for the Exploding Kittens base game.
 * Counts and behaviour are faithful to the original (Kickstarter) base game.
 */

import type { Theme } from './state.js';

export enum CardType {
  ExplodingKitten = 'exploding_kitten',
  Defuse = 'defuse',
  Nope = 'nope',
  Attack = 'attack',
  Skip = 'skip',
  Favor = 'favor',
  Shuffle = 'shuffle',
  SeeTheFuture = 'see_the_future',
  // Cat cards — no individual effect, used in combos.
  Tacocat = 'tacocat',
  Cattermelon = 'cattermelon',
  HairyPotatoCat = 'hairy_potato_cat',
  BeardCat = 'beard_cat',
  RainbowRalphingCat = 'rainbow_ralphing_cat',
}

export const CAT_CARDS: readonly CardType[] = [
  CardType.Tacocat,
  CardType.Cattermelon,
  CardType.HairyPotatoCat,
  CardType.BeardCat,
  CardType.RainbowRalphingCat,
];

/** True if the card is a "cat card" (only usable in combos). */
export function isCatCard(type: CardType): boolean {
  return CAT_CARDS.includes(type);
}

/** Action cards that can be cancelled by Nope. */
export const NOPEABLE_ACTIONS: readonly CardType[] = [
  CardType.Attack,
  CardType.Skip,
  CardType.Favor,
  CardType.Shuffle,
  CardType.SeeTheFuture,
];

/**
 * Composition of the non-Exploding-Kitten, non-Defuse portion of the base deck.
 * Exploding Kittens and Defuse cards are inserted during setup based on player count.
 */
export const BASE_DECK_COMPOSITION: Readonly<Record<CardType, number>> = {
  [CardType.ExplodingKitten]: 4, // total in the box; inserted = players - 1
  [CardType.Defuse]: 6, // total in the box; 1 dealt per player, remainder inserted
  [CardType.Nope]: 5,
  [CardType.Attack]: 4,
  [CardType.Skip]: 4,
  [CardType.Favor]: 4,
  [CardType.Shuffle]: 4,
  [CardType.SeeTheFuture]: 5,
  [CardType.Tacocat]: 4,
  [CardType.Cattermelon]: 4,
  [CardType.HairyPotatoCat]: 4,
  [CardType.BeardCat]: 4,
  [CardType.RainbowRalphingCat]: 4,
};

/** Human-readable names, faithful to the original card titles (cats theme). */
export const CARD_NAMES: Readonly<Record<CardType, string>> = {
  [CardType.ExplodingKitten]: 'Exploding Kitten',
  [CardType.Defuse]: 'Defuse',
  [CardType.Nope]: 'Nope',
  [CardType.Attack]: 'Attack',
  [CardType.Skip]: 'Skip',
  [CardType.Favor]: 'Favor',
  [CardType.Shuffle]: 'Shuffle',
  [CardType.SeeTheFuture]: 'See the Future',
  [CardType.Tacocat]: 'Tacocat',
  [CardType.Cattermelon]: 'Cattermelon',
  [CardType.HairyPotatoCat]: 'Hairy Potato Cat',
  [CardType.BeardCat]: 'Beard Cat',
  [CardType.RainbowRalphingCat]: 'Rainbow Ralphing Cat',
};

/**
 * Dog-skin card names — same cards and rules, dog-themed titles. Only the names
 * that reference cats change; the neutral action cards (Defuse, Nope, Attack,
 * Skip, Favor, Shuffle, See the Future) keep their titles. Stays consistent with
 * the "Exploding Puppy" / "Dog Cards" wording used elsewhere in the dog skin.
 */
export const DOG_CARD_NAMES: Readonly<Record<CardType, string>> = {
  ...CARD_NAMES,
  [CardType.ExplodingKitten]: 'Exploding Puppy',
  [CardType.Tacocat]: 'Tacodog',
  [CardType.Cattermelon]: 'Dogermelon',
  [CardType.HairyPotatoCat]: 'Hairy Potato Dog',
  [CardType.BeardCat]: 'Beard Dog',
  [CardType.RainbowRalphingCat]: 'Rainbow Ralphing Dog',
};

/** Card names keyed by theme. {@link cardNames} is the preferred accessor. */
export const THEME_CARD_NAMES: Readonly<Record<Theme, Readonly<Record<CardType, string>>>> = {
  cats: CARD_NAMES,
  dogs: DOG_CARD_NAMES,
};

/** Card names for a given theme, falling back to cats for unknown values. */
export function cardNames(theme: Theme | undefined): Readonly<Record<CardType, string>> {
  return (theme && THEME_CARD_NAMES[theme]) || CARD_NAMES;
}

/** A concrete card instance in play, with a stable unique id. */
export interface Card {
  id: string;
  type: CardType;
}

/** Game tuning constants — kept here so faithful defaults are easy to find/adjust. */
export const RULES = {
  /** Cards dealt to each player before adding their guaranteed Defuse (original = 7). */
  startingHandSize: 7,
  /** Min/max players supported by the base game. */
  minPlayers: 2,
  maxPlayers: 5,
  /** Number of top cards revealed by See the Future. */
  seeTheFutureCount: 3,
  /** Extra turns added to the next player by an Attack (stacks). */
  attackTurns: 2,
  /** Milliseconds the Nope window stays open (reset on each Nope). */
  nopeWindowMs: 5000,
  /**
   * Grace window after a blind steal opens during which the victim may
   * rearrange their face-down hand and the thief cannot pick yet.
   */
  stealShuffleMs: 3000,
  /** Hard ceiling on a single Nope window no matter how many Nopes stack. */
  maxNopeWindowMs: 20000,
  /** Milliseconds before an unanswered forced choice (Favor/Defuse) auto-resolves. */
  awaitingTimeoutMs: 30000,
  /** Milliseconds a disconnected current player's turn is auto-advanced after. */
  turnTimeoutMs: 45000,
} as const;
