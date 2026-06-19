import { describe, it, expect } from 'vitest';
import { AVATARS, defaultAvatarForIndex, isAvatar, pickAvatar } from './avatars.js';
import { addPlayer, createLobby } from './engine.js';

describe('pickAvatar', () => {
  it('prefers an avatar nobody has taken yet', () => {
    const taken = [AVATARS[0], AVATARS[1], AVATARS[2]];
    // randInt(free.length) === 0 -> the first still-free avatar.
    expect(pickAvatar(taken, () => 0)).toBe(AVATARS[3]);
    // Across the whole free range it never returns a taken avatar.
    const freeCount = AVATARS.length - taken.length;
    for (let i = 0; i < freeCount; i++) {
      const picked = pickAvatar(taken, () => i);
      expect(taken).not.toContain(picked);
      expect(isAvatar(picked)).toBe(true);
    }
  });

  it('falls back to any avatar when every one is taken', () => {
    const all = [...AVATARS];
    expect(isAvatar(pickAvatar(all, () => 0))).toBe(true);
    expect(pickAvatar(all, () => 5)).toBe(AVATARS[5]);
  });
});

describe('addPlayer avatar', () => {
  it('uses a provided valid avatar, ignoring an invalid one', () => {
    const good = addPlayer(createLobby(''), 'a', 'A', AVATARS[7]);
    expect(good.ok && good.state.players[0].avatar).toBe(AVATARS[7]);

    const bad = addPlayer(createLobby(''), 'a', 'A', '🛸');
    expect(bad.ok && bad.state.players[0].avatar).toBe(defaultAvatarForIndex(0));
  });
});
