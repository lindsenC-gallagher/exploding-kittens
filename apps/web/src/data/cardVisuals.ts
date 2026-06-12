import { CardType } from '@ek/shared';

export interface CardVisual {
  emoji: string;
  gradient: string;
  blurb: string;
}

/**
 * Original cat-themed art for each card — emoji + colour, not the copyrighted
 * official illustrations. Names and rules stay faithful to the base game.
 */
export const CARD_VISUALS: Record<CardType, CardVisual> = {
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
