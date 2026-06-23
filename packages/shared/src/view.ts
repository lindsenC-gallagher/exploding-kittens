import { DEFAULT_AVATAR } from './avatars.js';
import { RULES } from './cards.js';
import { DEFAULT_OPTIONS, type GameEvent, type GameState } from './state.js';
import type { ClientGameView, PublicPlayer, SpectatorReason } from './protocol.js';

/**
 * Project the authoritative game state into a redacted, personalized view for
 * one recipient. Hidden information (other players' hands, the draw-pile order)
 * never leaves the server. Single-sourced so redaction can't drift per call site.
 */
export function projectView(
  state: GameState,
  roomCode: string,
  recipientId: string,
  nopeDeadline: number | null,
  stealPickableAt: number | null = null,
): ClientGameView {
  const players: PublicPlayer[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar ?? DEFAULT_AVATAR,
    handCount: p.hand.length,
    alive: p.alive,
    connected: p.connected,
    ready: p.ready,
    isHost: p.id === state.hostId,
  }));

  const me = state.players.find((p) => p.id === recipientId);
  const current = state.phase === 'playing' ? state.players[state.currentPlayerIndex] : null;

  let prompt: ClientGameView['prompt'] = null;
  let stealPick: ClientGameView['stealPick'] = null;
  if (state.awaiting) {
    if (state.awaiting.type === 'defuse_or_explode' && state.awaiting.playerId === recipientId) {
      prompt = { type: 'defuse_or_explode' };
    } else if (state.awaiting.type === 'favor_give' && state.awaiting.playerId === recipientId) {
      prompt = { type: 'favor_give', toPlayerId: state.awaiting.toPlayerId };
    } else if (state.awaiting.type === 'steal_pick') {
      // Public: everyone learns a blind steal is happening (a pair was visibly
      // played). The thief uses it to render the picker; the victim, to rearrange.
      stealPick = {
        by: state.awaiting.playerId,
        from: state.awaiting.fromPlayerId,
        pickableAt: stealPickableAt ?? 0,
      };
    }
  }

  return {
    phase: state.phase,
    roomCode,
    youId: recipientId,
    hostId: state.hostId,
    options: state.options ?? DEFAULT_OPTIONS,
    players,
    yourHand: me ? me.hand : [],
    currentPlayerId: current ? current.id : null,
    turnsRemaining: state.turnsRemaining,
    drawPileCount: state.drawPile.length,
    discardTop: state.discardPile.length ? state.discardPile[state.discardPile.length - 1] : null,
    discardPile: state.discardPile,
    nope: state.pending
      ? {
          by: state.pending.by,
          kind: state.pending.kind,
          nopes: state.pending.nopes,
          deadline: nopeDeadline ?? 0,
          target: state.pending.target,
        }
      : null,
    prompt,
    stealPick,
    // Offered only to the player the Attack/Skip landed on, and only until they
    // act: a last chance to Nope it and bounce the turn back. Everyone else
    // just sees the normal turn.
    reverseTurnPass:
      state.reversibleTurnPass && state.reversibleTurnPass.victimId === recipientId
        ? { kind: state.reversibleTurnPass.kind, by: state.reversibleTurnPass.by }
        : null,
    winnerId: state.winnerId ?? null,
    isSpectator: false,
    spectator: null,
    version: state.version,
  };
}

/**
 * Project an unredacted view for a spectator: every player's full hand and the
 * entire draw-pile order are revealed. Spectators are not seated players, so
 * `yourHand` is empty and no per-player prompts are offered. Make sure the
 * caller only ever sends this to spectator sockets. `reason` explains why this
 * viewer is watching, so the UI can label it.
 */
export function projectSpectatorView(
  state: GameState,
  roomCode: string,
  nopeDeadline: number | null,
  stealPickableAt: number | null = null,
  reason: SpectatorReason = 'watching',
): ClientGameView {
  const base = projectView(state, roomCode, '', nopeDeadline, stealPickableAt);
  return {
    ...base,
    isSpectator: true,
    spectator: {
      hands: state.players.map((p) => ({ playerId: p.id, cards: p.hand })),
      drawPile: state.drawPile,
      reason,
    },
  };
}

/**
 * Whether a seated player should now watch as a spectator: they've been
 * eliminated (exploded) while the game is still in progress. They keep their
 * seat — a new game deals them back in as a normal player — but for the rest of
 * the current game they get the unredacted spectator view (every hand + the
 * deck) in place of a dead player's empty view.
 */
export function shouldSpectate(state: GameState, playerId: string): boolean {
  return state.phase === 'playing' && state.players.some((p) => p.id === playerId && !p.alive);
}

/**
 * Redact a single event for one recipient. Mirrors {@link projectView}: hidden
 * information must be stripped per-recipient and single-sourced so it can't
 * drift. Currently this hides which card a steal moved from everyone except the
 * thief and the victim (both of whom legitimately know it).
 */
export function redactEventForRecipient(event: GameEvent, recipientId: string): GameEvent {
  if (event.type === 'stole' && event.card && recipientId !== event.by && recipientId !== event.from) {
    return { type: 'stole', by: event.by, from: event.from, viaCombo: event.viaCombo };
  }
  // A drawn card's identity is private to the drawer; everyone else just learns
  // that *a* card was drawn (and sees a face-down card fly to the drawer).
  if (event.type === 'card_drawn' && event.card && recipientId !== event.by) {
    return { type: 'card_drawn', by: event.by };
  }
  return event;
}

export { RULES };
