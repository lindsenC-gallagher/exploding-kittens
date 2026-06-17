import { describe, expect, it } from 'vitest';
import { AVATARS } from './avatars.js';
import { CardType } from './cards.js';
import { parseClientMessage } from './validate.js';

const j = (v: unknown) => JSON.stringify(v);

describe('parseClientMessage — well-formed messages', () => {
  it('accepts each valid client message', () => {
    expect(parseClientMessage(j({ t: 'join', name: 'Cat' }))).toEqual({ t: 'join', name: 'Cat' });
    expect(parseClientMessage(j({ t: 'set_ready', ready: true }))).toEqual({ t: 'set_ready', ready: true });
    expect(parseClientMessage(j({ t: 'start_game' }))).toEqual({ t: 'start_game' });
    expect(parseClientMessage(j({ t: 'draw' }))).toEqual({ t: 'draw' });
    expect(parseClientMessage(j({ t: 'leave' }))).toEqual({ t: 'leave' });
    expect(parseClientMessage(j({ t: 'nope', cardId: 'c1' }))).toEqual({ t: 'nope', cardId: 'c1' });
    expect(parseClientMessage(j({ t: 'give_favor_card', cardId: 'c2' }))).toEqual({
      t: 'give_favor_card',
      cardId: 'c2',
    });
    expect(parseClientMessage(j({ t: 'defuse', cardId: 'c3', insertPosition: 0 }))).toEqual({
      t: 'defuse',
      cardId: 'c3',
      insertPosition: 0,
    });
    expect(parseClientMessage(j({ t: 'reorder_hand', order: ['c1', 'c2'] }))).toEqual({
      t: 'reorder_hand',
      order: ['c1', 'c2'],
    });
    expect(parseClientMessage(j({ t: 'steal_pick', cardIndex: 2 }))).toEqual({
      t: 'steal_pick',
      cardIndex: 2,
    });
  });

  it('accepts a full combo play with optional fields', () => {
    const msg = parseClientMessage(
      j({ t: 'play', cardIds: ['c1', 'c2'], combo: 'pair', target: 'p2', namedCard: CardType.Shuffle }),
    );
    expect(msg).toEqual({
      t: 'play',
      cardIds: ['c1', 'c2'],
      combo: 'pair',
      target: 'p2',
      namedCard: CardType.Shuffle,
      discardCardId: undefined,
    });
  });

  it('accepts set_avatar with an allowed avatar and rejects anything else', () => {
    expect(parseClientMessage(j({ t: 'set_avatar', avatar: AVATARS[0] }))).toEqual({
      t: 'set_avatar',
      avatar: AVATARS[0],
    });
    expect(parseClientMessage(j({ t: 'set_avatar', avatar: '🛸' }))).toBeNull(); // not in the set
    expect(parseClientMessage(j({ t: 'set_avatar', avatar: 42 }))).toBeNull();
    expect(parseClientMessage(j({ t: 'set_avatar' }))).toBeNull();
  });

  it('coerces a missing/non-string join name to empty (clamped server-side)', () => {
    expect(parseClientMessage(j({ t: 'join' }))).toEqual({ t: 'join', name: '' });
    expect(parseClientMessage(j({ t: 'join', name: 42 }))).toEqual({ t: 'join', name: '' });
  });

  it('accepts set_options with a partial set of boolean flags', () => {
    expect(parseClientMessage(j({ t: 'set_options', options: { allowFiveDifferent: false } }))).toEqual({
      t: 'set_options',
      options: { allowFiveDifferent: false },
    });
    expect(
      parseClientMessage(
        j({ t: 'set_options', options: { allowPairSteal: true, allowTripleDemand: false } }),
      ),
    ).toEqual({ t: 'set_options', options: { allowPairSteal: true, allowTripleDemand: false } });
    // An empty options object is valid (a no-op merge) and unknown keys are dropped.
    expect(parseClientMessage(j({ t: 'set_options', options: { bogus: true } }))).toEqual({
      t: 'set_options',
      options: {},
    });
  });

  it('accepts set_options with a valid theme and alongside flags', () => {
    expect(parseClientMessage(j({ t: 'set_options', options: { theme: 'dogs' } }))).toEqual({
      t: 'set_options',
      options: { theme: 'dogs' },
    });
    expect(parseClientMessage(j({ t: 'set_options', options: { theme: 'cats' } }))).toEqual({
      t: 'set_options',
      options: { theme: 'cats' },
    });
    expect(
      parseClientMessage(j({ t: 'set_options', options: { allowPairSteal: false, theme: 'dogs' } })),
    ).toEqual({ t: 'set_options', options: { allowPairSteal: false, theme: 'dogs' } });
  });
});

describe('parseClientMessage — malformed input is rejected (DoS hardening)', () => {
  it('rejects non-JSON and non-object payloads', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage(j(42))).toBeNull();
    expect(parseClientMessage(j(null))).toBeNull();
    expect(parseClientMessage(j(['array']))).toBeNull();
  });

  it('rejects unknown / missing message types', () => {
    expect(parseClientMessage(j({ t: 'nope_nope' }))).toBeNull();
    expect(parseClientMessage(j({ foo: 'bar' }))).toBeNull();
  });

  it('rejects a play with a missing or non-array cardIds (the crash payload)', () => {
    expect(parseClientMessage(j({ t: 'play' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'play', cardIds: 123 }))).toBeNull();
    expect(parseClientMessage(j({ t: 'play', cardIds: 'c1' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'play', cardIds: [] }))).toBeNull();
    expect(parseClientMessage(j({ t: 'play', cardIds: [1, 2] }))).toBeNull();
  });

  it('rejects a play with too many cards or a bogus combo/namedCard', () => {
    expect(parseClientMessage(j({ t: 'play', cardIds: ['a', 'b', 'c', 'd', 'e', 'f'] }))).toBeNull();
    expect(parseClientMessage(j({ t: 'play', cardIds: ['a', 'b'], combo: 'quad' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'play', cardIds: ['a'], namedCard: 'not_a_card' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'play', cardIds: ['a'], target: 99 }))).toBeNull();
  });

  it('rejects a defuse with a non-integer / negative / huge insertPosition', () => {
    expect(parseClientMessage(j({ t: 'defuse', cardId: 'c1', insertPosition: -1 }))).toBeNull();
    expect(parseClientMessage(j({ t: 'defuse', cardId: 'c1', insertPosition: 1.5 }))).toBeNull();
    expect(parseClientMessage(j({ t: 'defuse', cardId: 'c1', insertPosition: 1e9 }))).toBeNull();
    expect(parseClientMessage(j({ t: 'defuse', cardId: 'c1' }))).toBeNull();
    // NaN / Infinity don't survive JSON, but guard the raw shape anyway:
    expect(parseClientMessage('{"t":"defuse","cardId":"c1","insertPosition":null}')).toBeNull();
  });

  it('rejects nope / give_favor_card / set_ready with wrong field types', () => {
    expect(parseClientMessage(j({ t: 'nope' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'nope', cardId: 5 }))).toBeNull();
    expect(parseClientMessage(j({ t: 'give_favor_card' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'set_ready', ready: 'yes' }))).toBeNull();
  });

  it('rejects reorder_hand / steal_pick with wrong field types', () => {
    expect(parseClientMessage(j({ t: 'reorder_hand' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'reorder_hand', order: [] }))).toBeNull();
    expect(parseClientMessage(j({ t: 'reorder_hand', order: [1, 2] }))).toBeNull();
    expect(parseClientMessage(j({ t: 'reorder_hand', order: 'c1' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'steal_pick' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'steal_pick', cardIndex: -1 }))).toBeNull();
    expect(parseClientMessage(j({ t: 'steal_pick', cardIndex: 1.5 }))).toBeNull();
  });

  it('rejects set_options with a non-object or non-boolean flag', () => {
    expect(parseClientMessage(j({ t: 'set_options' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'set_options', options: 'all' }))).toBeNull();
    expect(parseClientMessage(j({ t: 'set_options', options: null }))).toBeNull();
    expect(parseClientMessage(j({ t: 'set_options', options: { allowPairSteal: 'yes' } }))).toBeNull();
  });

  it('rejects set_options with an unknown or non-string theme', () => {
    expect(parseClientMessage(j({ t: 'set_options', options: { theme: 'fish' } }))).toBeNull();
    expect(parseClientMessage(j({ t: 'set_options', options: { theme: 7 } }))).toBeNull();
  });

  it('rejects oversized frames', () => {
    const huge = j({ t: 'join', name: 'x'.repeat(5000) });
    expect(parseClientMessage(huge)).toBeNull();
  });
});
