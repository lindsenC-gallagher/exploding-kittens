import { describe, expect, it } from 'vitest';
import { CARD_NAMES, CardType, DOG_CARD_NAMES, cardNames } from './cards.js';

describe('cardNames', () => {
  it('returns the cat titles for the cats theme', () => {
    expect(cardNames('cats')).toBe(CARD_NAMES);
    expect(cardNames('cats')[CardType.ExplodingKitten]).toBe('Exploding Kitten');
    expect(cardNames('cats')[CardType.Tacocat]).toBe('Tacocat');
  });

  it('returns dog titles for the dogs theme — no "cat" wording leaks through', () => {
    const dog = cardNames('dogs');
    expect(dog).toBe(DOG_CARD_NAMES);
    expect(dog[CardType.ExplodingKitten]).toBe('Exploding Puppy');
    expect(dog[CardType.Tacocat]).toBe('Tacodog');
    expect(dog[CardType.Cattermelon]).toBe('Dogermelon');
    expect(dog[CardType.HairyPotatoCat]).toBe('Hairy Potato Dog');
    expect(dog[CardType.BeardCat]).toBe('Beard Dog');
    expect(dog[CardType.RainbowRalphingCat]).toBe('Rainbow Ralphing Dog');
    for (const name of Object.values(dog)) {
      expect(name.toLowerCase()).not.toContain('cat');
      expect(name.toLowerCase()).not.toContain('kitten');
    }
  });

  it('leaves the neutral action cards unchanged across themes', () => {
    for (const t of [
      CardType.Defuse,
      CardType.Nope,
      CardType.Attack,
      CardType.Skip,
      CardType.Favor,
      CardType.Shuffle,
      CardType.SeeTheFuture,
    ]) {
      expect(cardNames('dogs')[t]).toBe(CARD_NAMES[t]);
    }
  });

  it('falls back to the cat titles for an undefined theme', () => {
    expect(cardNames(undefined)).toBe(CARD_NAMES);
  });
});
