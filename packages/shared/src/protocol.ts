import type { Card, CardType } from './cards.js';
import type { ComboKind, GameEvent, GamePhase } from './state.js';

/**
 * Wire protocol between the React client and the GameRoom Durable Object.
 * Messages are JSON over a single WebSocket per player.
 */

// ---- Client -> Server ------------------------------------------------------

export type ClientMessage =
  | { t: 'join'; name: string }
  | { t: 'set_ready'; ready: boolean }
  | { t: 'start_game' }
  | { t: 'play'; cardIds: string[]; combo?: ComboKind; target?: string; namedCard?: CardType; discardCardId?: string }
  | { t: 'nope'; cardId: string }
  | { t: 'draw' }
  | { t: 'defuse'; cardId: string; insertPosition: number }
  | { t: 'give_favor_card'; cardId: string }
  | { t: 'leave' };

// ---- Server -> Client ------------------------------------------------------

/** A player as seen by others — hand contents are hidden, only the count shows. */
export interface PublicPlayer {
  id: string;
  name: string;
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
  /** Set when an action is in its Nope window. */
  nope: { by: string; kind: ComboKind | CardType; nopes: number; deadline: number } | null;
  /** Set when the game is waiting on YOU for a forced choice. */
  prompt:
    | { type: 'defuse_or_explode' }
    | { type: 'favor_give'; toPlayerId: string }
    | null;
  winnerId: string | null;
  version: number;
}

export type ServerMessage =
  | { t: 'view'; view: ClientGameView }
  | { t: 'events'; events: GameEvent[] }
  /** See the Future result, sent only to the viewing player. */
  | { t: 'see_future'; cards: Card[] }
  | { t: 'error'; message: string }
  | { t: 'joined'; youId: string; roomCode: string };
