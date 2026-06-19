import { describe, it, expect } from 'vitest';
import { createRng, shuffle } from './rng.js';

describe('rng', () => {
  it('int(max) stays within [0, max)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = Array.from({ length: 20 }, () => createRng(7).int(1000));
    const b = Array.from({ length: 20 }, () => createRng(7).int(1000));
    expect(a).toEqual(b);
    expect(shuffle([1, 2, 3, 4, 5, 6], createRng(99))).toEqual(shuffle([1, 2, 3, 4, 5, 6], createRng(99)));
  });
});

describe('shuffle (Fisher-Yates correctness)', () => {
  it('returns a permutation: same multiset, no loss or duplication', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    for (const seed of [1, 2, 3, 1234, 99999]) {
      const out = shuffle(input, createRng(seed));
      expect(out).toHaveLength(input.length);
      expect([...out].sort((a, b) => a - b)).toEqual(input);
    }
  });

  it('does not mutate its input', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    shuffle(input, createRng(5));
    expect(input).toEqual(copy);
  });

  it('is unbiased enough that every element reaches every position over many seeds', () => {
    const n = 4;
    const input = Array.from({ length: n }, (_, i) => i);
    // counts[value][position] = how often `value` landed at `position`.
    const counts = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const trials = 4000;
    for (let seed = 1; seed <= trials; seed++) {
      const out = shuffle(input, createRng(seed));
      out.forEach((value, pos) => counts[value][pos]++);
    }
    // Every (value, position) pair should occur, and roughly uniformly (~1/n).
    const expected = trials / n;
    for (let v = 0; v < n; v++) {
      for (let pos = 0; pos < n; pos++) {
        expect(counts[v][pos]).toBeGreaterThan(0);
        // Within 40% of the uniform expectation — loose, just catches gross bias.
        expect(Math.abs(counts[v][pos] - expected) / expected).toBeLessThan(0.4);
      }
    }
  });
});
