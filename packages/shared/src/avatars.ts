/**
 * Selectable player avatars. Emoji only (no asset files) so they render
 * identically everywhere and add zero load cost. The set is shared so the
 * server can validate a chosen avatar and assign a sensible default on join.
 */
export const AVATARS = [
  '🐱',
  '😺',
  '😸',
  '😻',
  '😼',
  '🦁',
  '🐯',
  '🐰',
  '🐼',
  '🐨',
  '🦊',
  '🐸',
  '🐶',
  '🐵',
  '🐷',
  '🐮',
  '🐔',
  '🦄',
  '🐲',
  '🦖',
] as const;

export type Avatar = (typeof AVATARS)[number];

export const DEFAULT_AVATAR: Avatar = AVATARS[0];

/** Is `v` one of the allowed avatars? Used to validate untrusted client input. */
export function isAvatar(v: unknown): v is Avatar {
  return typeof v === 'string' && (AVATARS as readonly string[]).includes(v);
}

/** Pick a default avatar for the n-th player to join (cycles through the set). */
export function defaultAvatarForIndex(index: number): Avatar {
  return AVATARS[((index % AVATARS.length) + AVATARS.length) % AVATARS.length];
}

/**
 * Pick an avatar for a joining player, preferring ones nobody has taken yet so
 * the table starts visually distinct. `randInt(max)` returns an integer in
 * [0, max). Falls back to any avatar if every one is already taken.
 */
export function pickAvatar(taken: readonly string[], randInt: (max: number) => number): Avatar {
  const takenSet = new Set(taken);
  const free = AVATARS.filter((a) => !takenSet.has(a));
  const pool = free.length > 0 ? free : AVATARS;
  return pool[randInt(pool.length)];
}
