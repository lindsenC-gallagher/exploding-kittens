import type { Card, CardType } from './cards.js';

export type GamePhase = 'lobby' | 'playing' | 'gameOver';

export interface PlayerState {
  id: string;
  name: string;
  /** Chosen avatar emoji (one of {@link AVATARS}); assigned a default on join. */
  avatar: string;
  hand: Card[];
  alive: boolean;
  connected: boolean;
  ready: boolean;
}

/** Combo kinds playable with matching/distinct cards. */
export type ComboKind = 'pair' | 'triple' | 'five_different';

/**
 * Purely cosmetic card-art skin chosen by the host in the lobby. `cats` is the
 * faithful original; `dogs` swaps the emoji art (no rules change). Threaded to
 * every client via {@link GameOptions} so the whole table sees the same skin.
 */
export type Theme = 'cats' | 'dogs';

/** All selectable themes, in display order (host lobby picker iterates this). */
export const THEMES: readonly Theme[] = ['cats', 'dogs'];

/**
 * Host-configurable "house rules" set in the lobby before the game starts.
 * Each flag enables an optional combo; all default to on (the faithful base
 * game). Disabling one makes the engine reject that combo and hides it client-side.
 */
export interface GameOptions {
  /** 2 matching cards → blindly steal a random card. */
  allowPairSteal: boolean;
  /** 3 matching cards → name a card and take it if the target has it. */
  allowTripleDemand: boolean;
  /** 5 different cards → take any card from the discard (the "5-card rule"). */
  allowFiveDifferent: boolean;
  /**
   * Cap how far chained Attacks can stack. When true (the default) the turns an
   * Attack passes on are capped at {@link GameOptions.maxAttackTurns}; when false
   * they stack without limit (the faithful base game: 2 → 4 → 6 → …).
   */
  limitAttackStacking: boolean;
  /**
   * The cap used when {@link GameOptions.limitAttackStacking} is on. At least
   * {@link MIN_ATTACK_TURNS} (2 — a single Attack always passes 2); the host may
   * raise it up to {@link MAX_ATTACK_TURNS} to allow deeper chains.
   */
  maxAttackTurns: number;
  /**
   * Play with a trimmed deck for faster games. When true the engine roughly
   * halves the non-essential card pool (cat cards and action cards), so big
   * tables (6-9 players, which combine two decks) don't drag on. Exploding
   * Kittens and Defuse are untouched, so the game stays fair and survivable, and
   * the trim is clamped so every player can always be dealt a full starting hand.
   * Default `false` (the faithful full deck).
   */
  smallerDeck: boolean;
  /** Cosmetic card-art skin for the whole table. Default `cats`. */
  theme: Theme;
}

/** Inclusive bounds for {@link GameOptions.maxAttackTurns}. */
export const MIN_ATTACK_TURNS = 2;
export const MAX_ATTACK_TURNS = 10;

/**
 * Defaults: every combo enabled and classic cat art (faithful), but Attack
 * stacking is capped at 2 by default — the host can raise the cap or switch to
 * faithful unlimited stacking in the lobby.
 */
export const DEFAULT_OPTIONS: GameOptions = {
  allowPairSteal: true,
  allowTripleDemand: true,
  allowFiveDifferent: true,
  limitAttackStacking: true,
  maxAttackTurns: MIN_ATTACK_TURNS,
  smallerDeck: false,
  theme: 'cats',
};

/**
 * An action that has been played and is sitting in the Nope window, awaiting
 * resolution. `nopes` counts how many Nope cards have stacked: even => the
 * action resolves, odd => it is cancelled.
 */
export interface PendingAction {
  /** Player who played the action. */
  by: string;
  /** Card type of a single action card, or the combo kind. */
  kind: CardType | ComboKind;
  /** Target player for Favor / combos. */
  target?: string;
  /** Named card type for a triple combo. */
  namedCard?: CardType;
  /** Discard card id chosen for a five-different combo. */
  discardCardId?: string;
  /** Cards that were moved to the discard pile for this action (for logging). */
  playedCardIds: string[];
  /** Number of Nopes stacked so far. */
  nopes: number;
}

/**
 * A resolved Attack or Skip that the new current player may still undo at the
 * start of their turn (see {@link GameState.reversibleTurnPass}). Carries a
 * snapshot of the previous player's turn state so reversal restores it exactly,
 * as if the card had never been played (the card itself is already spent).
 */
export interface ReversibleTurnPass {
  /** The card that passed the turn — Attack or Skip (for the log/undo prompt). */
  kind: CardType;
  /** Player who played it; the turn bounces back to them on reversal. */
  by: string;
  /** That player's seat index before the action, restored on reversal. */
  prevPlayerIndex: number;
  /** That player's outstanding turns before the action. */
  prevTurnsRemaining: number;
  /** That player's `attacked` flag before the action. */
  prevAttacked: boolean;
  /** The new current player — the only one allowed to reverse it. */
  victimId: string;
}

/** A forced choice the game is waiting on before play can continue. */
export type AwaitingChoice =
  | {
      /** A player drew an Exploding Kitten and must Defuse or explode. */
      type: 'defuse_or_explode';
      playerId: string;
      /**
       * The drawn Exploding Kitten, held off-pile while the choice is pending so
       * it never leaks into the public discard view before it resolves.
       */
      explodingCard: Card;
    }
  | {
      /** Target of a resolved Favor must give a card of their choice. */
      type: 'favor_give';
      /** Player who must give a card. */
      playerId: string;
      /** Player who will receive it. */
      toPlayerId: string;
    }
  | {
      /**
       * A resolved pair lets the thief blindly pick one of the target's
       * (face-down) cards. Faithful to the base game, where you take a *random*
       * card by choosing one from a fanned, face-down hand. The target may
       * rearrange their hand while this is pending to throw the thief off.
       */
      type: 'steal_pick';
      /** The thief who must choose a card index. */
      playerId: string;
      /** The player being stolen from. */
      fromPlayerId: string;
      /** The combo that triggered the steal (currently always 'pair'). */
      via: ComboKind;
    };

export interface GameState {
  phase: GamePhase;
  hostId: string;
  /** Host-configurable house rules, fixed once the game starts. */
  options: GameOptions;
  players: PlayerState[];
  currentPlayerIndex: number;
  /** Turns the current player must still take (>=1 while playing). */
  turnsRemaining: number;
  /**
   * Whether the current player's outstanding turns were granted by an Attack
   * (as opposed to their single normal turn). Lets Attack stack correctly:
   * a fresh player passes 2; an attacked player passes their remaining + 2.
   */
  attacked: boolean;
  /** Draw pile, index 0 = top of the deck (next to be drawn). */
  drawPile: Card[];
  discardPile: Card[];
  pending?: PendingAction;
  awaiting?: AwaitingChoice;
  /**
   * A turn-passing action (Attack or Skip) that has already cleared its Nope
   * window and handed the turn to a new player. That new player — and only them
   * — may still Nope it at the very start of their turn, before they play or
   * draw, to bounce the turn back to whoever played it. This is a second,
   * personal grace on top of the shared Nope window: the table froze and
   * everyone could Nope during the window; this is the victim's last word once
   * it has resolved onto them. Cleared the instant they take their first action.
   */
  reversibleTurnPass?: ReversibleTurnPass;
  winnerId?: string;
  /** Monotonic version, bumped on every applied action. */
  version: number;
}

/** Events emitted by the engine to drive client animations / logs. */
export type GameEvent =
  | { type: 'game_started'; playerOrder: string[] }
  | { type: 'cards_played'; by: string; cards: Card[]; combo?: ComboKind; target?: string }
  | { type: 'nope'; by: string; nopes: number }
  | { type: 'action_resolved'; kind: PendingAction['kind']; cancelled: boolean }
  /**
   * The new current player Noped a resolved Attack/Skip at the start of their
   * turn, bouncing it back. `reverser` played the Nope; `restoredTo` got their
   * turn back.
   */
  | { type: 'turn_pass_reversed'; kind: CardType; reverser: string; restoredTo: string }
  | {
      type: 'card_drawn';
      by: string;
      /**
       * The card that was drawn. Present only on the copy routed to the drawer
       * (so their client can reveal it face up as it flies into their hand);
       * redacted for everyone else so the draw stays hidden. See
       * `redactEventForRecipient`. Omitted when the draw was an Exploding Kitten
       * (the defuse/explosion flow takes over visually).
       */
      card?: Card;
    }
  | { type: 'see_future'; by: string; cards: Card[] }
  | { type: 'shuffled' }
  | { type: 'favor_requested'; from: string; to: string }
  | { type: 'card_given'; from: string; to: string }
  | {
      type: 'stole';
      by: string;
      from: string;
      viaCombo: ComboKind;
      /**
       * The stolen card. Present only on the copies routed to the thief and the
       * victim — redacted (omitted) for every other recipient so a steal stays
       * hidden information. See `redactEventForRecipient`.
       */
      card?: Card;
    }
  | { type: 'took_from_discard'; by: string; card: Card }
  | { type: 'exploded'; playerId: string }
  | { type: 'defused'; playerId: string }
  | { type: 'turn_changed'; playerId: string; turnsRemaining: number }
  | { type: 'game_over'; winnerId: string };

/** Result of applying an action to the state. */
export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };
