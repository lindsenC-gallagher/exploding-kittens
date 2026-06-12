import { RULES } from './cards.js';
import type { GameState } from './state.js';
import type { ClientGameView, PublicPlayer } from './protocol.js';

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
): ClientGameView {
  const players: PublicPlayer[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    handCount: p.hand.length,
    alive: p.alive,
    connected: p.connected,
    ready: p.ready,
    isHost: p.id === state.hostId,
  }));

  const me = state.players.find((p) => p.id === recipientId);
  const current = state.phase === 'playing' ? state.players[state.currentPlayerIndex] : null;

  let prompt: ClientGameView['prompt'] = null;
  if (state.awaiting) {
    if (state.awaiting.type === 'defuse_or_explode' && state.awaiting.playerId === recipientId) {
      prompt = { type: 'defuse_or_explode' };
    } else if (state.awaiting.type === 'favor_give' && state.awaiting.playerId === recipientId) {
      prompt = { type: 'favor_give', toPlayerId: state.awaiting.toPlayerId };
    }
  }

  return {
    phase: state.phase,
    roomCode,
    youId: recipientId,
    hostId: state.hostId,
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
        }
      : null,
    prompt,
    winnerId: state.winnerId ?? null,
    version: state.version,
  };
}

export { RULES };
