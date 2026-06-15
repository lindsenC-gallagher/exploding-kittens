import type { Card, CardType } from './cards.js';

export type GamePhase = 'lobby' | 'playing' | 'gameOver';

export interface PlayerState {
  id: string;
  name: string;
  hand: Card[];
  alive: boolean;
  connected: boolean;
  ready: boolean;
}

/** Combo kinds playable with matching/distinct cards. */
export type ComboKind = 'pair' | 'triple' | 'five_different';

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
  winnerId?: string;
  /** Monotonic version, bumped on every applied action. */
  version: number;
}

/** Events emitted by the engine to drive client animations / logs. */
export type GameEvent =
  | { type: 'game_started'; playerOrder: string[] }
  | { type: 'cards_played'; by: string; cards: Card[]; combo?: ComboKind }
  | { type: 'nope'; by: string; nopes: number }
  | { type: 'action_resolved'; kind: PendingAction['kind']; cancelled: boolean }
  | { type: 'card_drawn'; by: string }
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
