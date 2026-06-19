import { isAvatar } from './avatars.js';
import { CardType } from './cards.js';
import type { ClientMessage } from './protocol.js';
import type { ComboKind, GameOptions, Theme } from './state.js';
import { MAX_ATTACK_TURNS, MIN_ATTACK_TURNS, THEMES } from './state.js';

/**
 * Runtime validation of untrusted client messages — the trust boundary between
 * the WebSocket and the engine. The engine assumes well-typed actions, so every
 * field a client controls is checked here (types, array-ness, finite
 * non-negative integers). Malformed input returns null and is ignored rather
 * than crashing the Durable Object.
 */

/** Largest raw frame we will even attempt to parse. */
export const MAX_MESSAGE_BYTES = 4096;

const COMBO_KINDS: readonly ComboKind[] = ['pair', 'triple', 'five_different'];
const CARD_TYPES: ReadonlySet<string> = new Set(Object.values(CardType));
/** A combo is at most 5 cards (five-different); single/pair/triple are fewer. */
const MAX_CARDS_PER_PLAY = 5;
/** Generous upper bound on a hand size for a `reorder_hand` permutation. */
const MAX_HAND_IDS = 64;
/** The boolean house-rule flags a client may toggle. */
const OPTION_KEYS = ['allowPairSteal', 'allowTripleDemand', 'allowFiveDifferent', 'limitAttackStacking'] as const;
const THEME_SET: ReadonlySet<string> = new Set(THEMES);

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100_000;
}

/**
 * Parse and narrow a raw WebSocket frame into a {@link ClientMessage}. Returns
 * null for anything malformed (bad JSON, wrong/missing fields, wrong types,
 * oversized arrays, non-integer indices, …) so the caller can safely drop it.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;

  switch (m.t) {
    case 'join':
      // The name is clamped/sanitized server-side; accept any string (or none).
      return { t: 'join', name: isStr(m.name) ? m.name : '' };

    case 'set_ready':
      if (typeof m.ready !== 'boolean') return null;
      return { t: 'set_ready', ready: m.ready };

    case 'set_avatar':
      if (!isAvatar(m.avatar)) return null;
      return { t: 'set_avatar', avatar: m.avatar };

    case 'set_options': {
      if (typeof m.options !== 'object' || m.options === null) return null;
      const src = m.options as Record<string, unknown>;
      const options: Partial<GameOptions> = {};
      for (const key of OPTION_KEYS) {
        if (key in src) {
          if (typeof src[key] !== 'boolean') return null;
          options[key] = src[key] as boolean;
        }
      }
      if ('maxAttackTurns' in src) {
        const v = src.maxAttackTurns;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_ATTACK_TURNS || v > MAX_ATTACK_TURNS) {
          return null;
        }
        options.maxAttackTurns = v;
      }
      if ('theme' in src) {
        if (!isStr(src.theme) || !THEME_SET.has(src.theme)) return null;
        options.theme = src.theme as Theme;
      }
      return { t: 'set_options', options };
    }

    case 'start_game':
      return { t: 'start_game' };

    case 'play_again':
      return { t: 'play_again' };

    case 'play': {
      if (!isStrArray(m.cardIds) || m.cardIds.length === 0 || m.cardIds.length > MAX_CARDS_PER_PLAY) {
        return null;
      }
      if (m.combo !== undefined && !COMBO_KINDS.includes(m.combo as ComboKind)) return null;
      if (m.target !== undefined && !isStr(m.target)) return null;
      if (m.namedCard !== undefined && !(isStr(m.namedCard) && CARD_TYPES.has(m.namedCard))) return null;
      if (m.discardCardId !== undefined && !isStr(m.discardCardId)) return null;
      return {
        t: 'play',
        cardIds: m.cardIds,
        combo: m.combo as ComboKind | undefined,
        target: m.target as string | undefined,
        namedCard: m.namedCard as CardType | undefined,
        discardCardId: m.discardCardId as string | undefined,
      };
    }

    case 'nope':
      if (!isStr(m.cardId)) return null;
      return { t: 'nope', cardId: m.cardId };

    case 'draw':
      return { t: 'draw' };

    case 'defuse':
      if (!isStr(m.cardId) || !isIndex(m.insertPosition)) return null;
      return { t: 'defuse', cardId: m.cardId, insertPosition: m.insertPosition };

    case 'give_favor_card':
      if (!isStr(m.cardId)) return null;
      return { t: 'give_favor_card', cardId: m.cardId };

    case 'reorder_hand':
      // A hand is bounded well below this; the cap just blunts oversized arrays.
      if (!isStrArray(m.order) || m.order.length === 0 || m.order.length > MAX_HAND_IDS) return null;
      return { t: 'reorder_hand', order: m.order };

    case 'steal_pick':
      if (!isIndex(m.cardIndex)) return null;
      return { t: 'steal_pick', cardIndex: m.cardIndex };

    case 'leave':
      return { t: 'leave' };

    default:
      return null;
  }
}
