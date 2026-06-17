import { CardType, type Theme } from '@ek/shared';

export interface CardVisual {
  emoji: string;
  gradient: string;
  blurb: string;
}

/**
 * Original cat-themed art for each card — emoji + colour, not the copyrighted
 * official illustrations. Names and rules stay faithful to the base game.
 */
const CAT_VISUALS: Record<CardType, CardVisual> = {
  [CardType.ExplodingKitten]: {
    emoji: '🙀💥',
    gradient: 'linear-gradient(160deg,#ff9a8b,#ff4d4d)',
    blurb: 'You explode unless you Defuse!',
  },
  [CardType.Defuse]: {
    emoji: '🧯🐈',
    gradient: 'linear-gradient(160deg,#a8ffce,#54e3a0)',
    blurb: 'Stops one Exploding Kitten.',
  },
  [CardType.Nope]: {
    emoji: '🚫😼',
    gradient: 'linear-gradient(160deg,#ffd9e0,#ff8fab)',
    blurb: 'Cancel any action. Even out of turn.',
  },
  [CardType.Attack]: {
    emoji: '⚔️😾',
    gradient: 'linear-gradient(160deg,#ffc3a0,#ff7b54)',
    blurb: 'End your turn; next player takes 2.',
  },
  [CardType.Skip]: {
    emoji: '⏭️🙀',
    gradient: 'linear-gradient(160deg,#c2e9fb,#8ec5fc)',
    blurb: 'End your turn without drawing.',
  },
  [CardType.Favor]: {
    emoji: '🎁🐱',
    gradient: 'linear-gradient(160deg,#fbc2eb,#a18cd1)',
    blurb: 'A player gives you a card.',
  },
  [CardType.Shuffle]: {
    emoji: '🔀🌀',
    gradient: 'linear-gradient(160deg,#d4fc79,#96e6a1)',
    blurb: 'Shuffle the draw pile.',
  },
  [CardType.SeeTheFuture]: {
    emoji: '🔮👀',
    gradient: 'linear-gradient(160deg,#e0c3fc,#8ec5fc)',
    blurb: 'Peek at the top 3 cards.',
  },
  [CardType.Tacocat]: {
    emoji: '🌮🐱',
    gradient: 'linear-gradient(160deg,#ffe29f,#ffa99f)',
    blurb: 'Cat card — play a pair to steal.',
  },
  [CardType.Cattermelon]: {
    emoji: '🍉🐱',
    gradient: 'linear-gradient(160deg,#a1ffce,#faffd1)',
    blurb: 'Cat card — play a pair to steal.',
  },
  [CardType.HairyPotatoCat]: {
    emoji: '🥔🐱',
    gradient: 'linear-gradient(160deg,#f6d365,#fda085)',
    blurb: 'Cat card — play a pair to steal.',
  },
  [CardType.BeardCat]: {
    emoji: '🧔🐱',
    gradient: 'linear-gradient(160deg,#cfd9df,#e2ebf0)',
    blurb: 'Cat card — play a pair to steal.',
  },
  [CardType.RainbowRalphingCat]: {
    emoji: '🌈🤮',
    gradient: 'linear-gradient(160deg,#fbc2eb,#a6c1ee)',
    blurb: 'Cat card — play a pair to steal.',
  },
};

/**
 * Dog-themed skin — same cards, same rules, dog emoji art. Gradients are reused
 * from the cat set so the two themes stay visually consistent; only the emoji
 * (and the "cat card" wording in blurbs) change.
 */
const DOG_VISUALS: Record<CardType, CardVisual> = {
  [CardType.ExplodingKitten]: {
    emoji: '🐶💥',
    gradient: CAT_VISUALS[CardType.ExplodingKitten].gradient,
    blurb: 'You explode unless you Defuse!',
  },
  [CardType.Defuse]: {
    emoji: '🧯🐕',
    gradient: CAT_VISUALS[CardType.Defuse].gradient,
    blurb: 'Stops one Exploding Puppy.',
  },
  [CardType.Nope]: {
    emoji: '🚫🐕',
    gradient: CAT_VISUALS[CardType.Nope].gradient,
    blurb: 'Cancel any action. Even out of turn.',
  },
  [CardType.Attack]: {
    emoji: '⚔️🐺',
    gradient: CAT_VISUALS[CardType.Attack].gradient,
    blurb: 'End your turn; next player takes 2.',
  },
  [CardType.Skip]: {
    emoji: '⏭️🐶',
    gradient: CAT_VISUALS[CardType.Skip].gradient,
    blurb: 'End your turn without drawing.',
  },
  [CardType.Favor]: {
    emoji: '🎁🐶',
    gradient: CAT_VISUALS[CardType.Favor].gradient,
    blurb: 'A player gives you a card.',
  },
  [CardType.Shuffle]: {
    emoji: '🔀🐾',
    gradient: CAT_VISUALS[CardType.Shuffle].gradient,
    blurb: 'Shuffle the draw pile.',
  },
  [CardType.SeeTheFuture]: {
    emoji: '🔮🐶',
    gradient: CAT_VISUALS[CardType.SeeTheFuture].gradient,
    blurb: 'Peek at the top 3 cards.',
  },
  [CardType.Tacocat]: {
    emoji: '🌮🐶',
    gradient: CAT_VISUALS[CardType.Tacocat].gradient,
    blurb: 'Dog card — play a pair to steal.',
  },
  [CardType.Cattermelon]: {
    emoji: '🍉🐶',
    gradient: CAT_VISUALS[CardType.Cattermelon].gradient,
    blurb: 'Dog card — play a pair to steal.',
  },
  [CardType.HairyPotatoCat]: {
    emoji: '🥔🐶',
    gradient: CAT_VISUALS[CardType.HairyPotatoCat].gradient,
    blurb: 'Dog card — play a pair to steal.',
  },
  [CardType.BeardCat]: {
    emoji: '🧔🐶',
    gradient: CAT_VISUALS[CardType.BeardCat].gradient,
    blurb: 'Dog card — play a pair to steal.',
  },
  [CardType.RainbowRalphingCat]: {
    emoji: '🌈🐩',
    gradient: CAT_VISUALS[CardType.RainbowRalphingCat].gradient,
    blurb: 'Dog card — play a pair to steal.',
  },
};

/** Card art keyed by theme. {@link cardVisuals} is the preferred accessor. */
export const THEME_VISUALS: Record<Theme, Record<CardType, CardVisual>> = {
  cats: CAT_VISUALS,
  dogs: DOG_VISUALS,
};

/** Card art for a given theme, falling back to cats for unknown values. */
export function cardVisuals(theme: Theme | undefined): Record<CardType, CardVisual> {
  return (theme && THEME_VISUALS[theme]) || CAT_VISUALS;
}
