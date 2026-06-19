import type { Card, CardType } from './cards.js';
import type { ComboKind, GameEvent, GameOptions, GamePhase } from './state.js';

/**
 * Wire protocol between the React client and the GameRoom Durable Object.
 * Messages are JSON over a single WebSocket per player.
 */

// ---- Client -> Server ------------------------------------------------------

export type ClientMessage =
  | { t: 'join'; name: string }
  | { t: 'set_ready'; ready: boolean }
  /** Lobby-only: change your display name (clamped/sanitized server-side). */
  | { t: 'set_name'; name: string }
  /** Choose your avatar (one of the shared AVATARS); cosmetic, allowed any time. */
  | { t: 'set_avatar'; avatar: string }
  /** Host-only, lobby-only: toggle one or more house rules. */
  | { t: 'set_options'; options: Partial<GameOptions> }
  | { t: 'start_game' }
  /** Host-only, after a game ends: return everyone to this room's lobby to play again. */
  | { t: 'play_again' }
  | { t: 'play'; cardIds: string[]; combo?: ComboKind; target?: string; namedCard?: CardType; discardCardId?: string }
  | { t: 'nope'; cardId: string }
  | { t: 'draw' }
  | { t: 'defuse'; cardId: string; insertPosition: number }
  | { t: 'give_favor_card'; cardId: string }
  /** Reorder your own hand (purely your private arrangement; ids must be a permutation). */
  | { t: 'reorder_hand'; order: string[] }
  /** Thief blindly picks the `cardIndex`-th of the target's face-down cards. */
  | { t: 'steal_pick'; cardIndex: number }
  | { t: 'leave' };

// ---- Server -> Client ------------------------------------------------------

/** A player as seen by others — hand contents are hidden, only the count shows. */
export interface PublicPlayer {
  id: string;
  name: string;
  /** Chosen avatar emoji (one of the shared AVATARS). */
  avatar: string;
  handCount: number;
  alive: boolean;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
}

/** A personalized, redacted view of the game for one recipient. */
export interface ClientGameView {
  phase: GamePhase;
  roomCode: string;
  youId: string;
  hostId: string;
  /** Active house rules (set by the host in the lobby). */
  options: GameOptions;
  players: PublicPlayer[];
  /** Your own hand (full detail). Empty until the game starts. */
  yourHand: Card[];
  currentPlayerId: string | null;
  turnsRemaining: number;
  drawPileCount: number;
  /** Top card of the discard pile (visible to all), if any. */
  discardTop: Card | null;
  /** Full discard pile (needed for the five-different combo picker). */
  discardPile: Card[];
  /**
   * Set when an action is in its Nope window. `target` (when present) is the
   * player the pending action is aimed at, so opponents can decide whether to
   * Nope an action now that they can see who it hits.
   */
  nope: {
    by: string;
    kind: ComboKind | CardType;
    nopes: number;
    deadline: number;
    target?: string;
  } | null;
  /** Set when the game is waiting on YOU for a forced choice. */
  prompt:
    | { type: 'defuse_or_explode' }
    | { type: 'favor_give'; toPlayerId: string }
    | null;
  /**
   * Set (for everyone) while a blind pair-steal is in progress: `by` is the
   * thief choosing a face-down card, `from` is the victim. The victim may
   * rearrange their hand to thwart the thief while this is set.
   */
  stealPick: {
    by: string;
    from: string;
    /**
     * Epoch ms before which the thief may NOT pick yet — the victim's grace
     * window to rearrange their (face-down) hand. The thief's picker stays
     * disabled until now; the victim can only reorder until then.
     */
    pickableAt: number;
  } | null;
  /**
   * Set only for the player a resolved Attack/Skip just handed the turn to,
   * while they may still Nope it (before they play or draw) to bounce it back to
   * whoever played it (`by`). Distinct from the shared `nope` window — this is
   * the victim's last word once the action has resolved onto them.
   */
  reverseTurnPass: { kind: CardType; by: string } | null;
  winnerId: string | null;
  /** True when this view is for a spectator (not a seated player). */
  isSpectator: boolean;
  /**
   * Present only for spectators: the unredacted hands of every player and the
   * full draw-pile order (top first). Null for seated players, who must never
   * receive this hidden information.
   */
  spectator: {
    hands: { playerId: string; cards: Card[] }[];
    drawPile: Card[];
  } | null;
  version: number;
}

export type ServerMessage =
  | { t: 'view'; view: ClientGameView }
  | { t: 'events'; events: GameEvent[] }
  /** See the Future result, sent only to the viewing player. */
  | { t: 'see_future'; cards: Card[] }
  | { t: 'error'; message: string }
  /** Sent once on connect; `token` is the per-seat secret to present on reconnect. */
  | { t: 'joined'; youId: string; roomCode: string; token: string };
