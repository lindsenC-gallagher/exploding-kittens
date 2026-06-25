import { useState } from 'react';
import { cardNames, type ClientGameView, type ClientMessage, type SpectatorReason } from '@ek/shared';
import { Card, CardBack } from './Card.js';
import { useTheme } from '../theme.js';

/** Short banner clause explaining why this viewer is spectating. */
const REASON_TEXT: Record<SpectatorReason, string> = {
  eliminated: "you're out — watching till the next game",
  'in-progress': "this game's already underway",
  'lobby-full': 'the table is full',
  watching: 'just watching',
};

/**
 * Read-only spectator screen. Shows every player's hand face-up and the full
 * draw-pile order (data the server only sends to spectators), with an obvious
 * "Spectating" banner so it's clear you're watching, not playing.
 */
export function SpectatorView({
  view,
  send,
  onLeave,
}: {
  view: ClientGameView;
  send: (msg: ClientMessage) => void;
  onLeave: () => void;
}) {
  const theme = useTheme();
  // The deck order is a big spoiler, so keep it face-down until clicked.
  const [deckRevealed, setDeckRevealed] = useState(false);
  const handOf = (playerId: string) =>
    view.spectator?.hands.find((h) => h.playerId === playerId)?.cards ?? [];
  const drawPile = view.spectator?.drawPile ?? [];
  const winner = view.players.find((p) => p.id === view.winnerId);
  const reason = view.spectator?.reason ?? 'watching';
  // An eliminated host can still rally the table for another game without
  // leaving the reveal. Read-only watchers have no seat, so they're never host.
  const isHost = view.youId !== '' && view.youId === view.hostId;
  const gameOver = view.phase === 'gameOver';

  return (
    <div className="spectator">
      <div className="spectator-banner">
        👁 Spectating · room <b>{view.roomCode}</b> · {REASON_TEXT[reason]}
        {gameOver && winner && ` · 🏆 ${winner.name} wins!`}
        {gameOver && isHost ? (
          <button style={{ marginLeft: 12 }} onClick={() => send({ t: 'play_again' })}>
            🔄 Play again
          </button>
        ) : gameOver ? (
          <span className="muted" style={{ marginLeft: 12 }}>
            waiting for the host to start a new game…
          </span>
        ) : null}
        <button className="ghost" style={{ marginLeft: 12 }} onClick={onLeave}>
          Leave
        </button>
      </div>

      <p className="muted spectator-note">
        You can see everyone&apos;s hands and the deck. You can&apos;t play — just watch.
      </p>

      <div className="spectator-players">
        {view.players.map((p) => {
          const isCurrent = p.id === view.currentPlayerId;
          const hand = handOf(p.id);
          return (
            <div key={p.id} className={`spectator-player ${isCurrent ? 'current' : ''} ${p.alive ? '' : 'dead'}`}>
              <div className="spectator-player-head">
                <span style={{ fontSize: 22 }}>{p.avatar}</span>
                <span className="spectator-player-name">{p.name}</span>
                {p.isHost && <span className="badge host">HOST</span>}
                {isCurrent && view.phase === 'playing' && <span className="badge ready">TURN</span>}
                {!p.alive && <span className="badge">💥 out</span>}
                {!p.connected && <span className="badge">offline</span>}
              </div>
              <div className="spectator-hand">
                {hand.length === 0 ? (
                  <span className="muted">no cards</span>
                ) : (
                  hand.map((c) => <Card key={c.id} type={c.type} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {view.phase !== 'lobby' && (
        <div className="spectator-deck">
          <button
            className="spectator-deck-toggle"
            aria-expanded={deckRevealed}
            onClick={() => setDeckRevealed((v) => !v)}
          >
            🂠 Draw pile · {drawPile.length} cards ·{' '}
            {deckRevealed ? 'hide order ▲' : 'reveal order ▼'}
          </button>
          {deckRevealed ? (
            <div className="spectator-deck-row">
              {drawPile.length === 0 ? (
                <span className="muted">empty</span>
              ) : (
                drawPile.map((c, i) => (
                  <div key={c.id} className="spectator-deck-card" title={cardNames(theme)[c.type]}>
                    <span className="badge" style={{ marginBottom: 4 }}>
                      {i === 0 ? 'next' : `+${i}`}
                    </span>
                    <Card type={c.type} />
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="spectator-deck-row" style={{ alignItems: 'center' }}>
              <CardBack count={drawPile.length} selectable onClick={() => setDeckRevealed(true)} />
              <span className="muted">click to peek the order (top first)</span>
            </div>
          )}
          {view.discardTop && (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontWeight: 800, marginBottom: 6 }}>
                🗑️ Discard top
              </div>
              <Card type={view.discardTop.type} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
