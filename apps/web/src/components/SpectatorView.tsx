import { cardNames, type ClientGameView } from '@ek/shared';
import { Card } from './Card.js';
import { useTheme } from '../theme.js';

/**
 * Read-only spectator screen. Shows every player's hand face-up and the full
 * draw-pile order (data the server only sends to spectators), with an obvious
 * "Spectating" banner so it's clear you're watching, not playing.
 */
export function SpectatorView({ view, onLeave }: { view: ClientGameView; onLeave: () => void }) {
  const theme = useTheme();
  const handOf = (playerId: string) =>
    view.spectator?.hands.find((h) => h.playerId === playerId)?.cards ?? [];
  const drawPile = view.spectator?.drawPile ?? [];
  const winner = view.players.find((p) => p.id === view.winnerId);

  return (
    <div className="spectator">
      <div className="spectator-banner">
        👁 Spectating · room <b>{view.roomCode}</b>
        {view.phase === 'lobby' && ' · waiting in the lobby'}
        {view.phase === 'gameOver' && winner && ` · 🏆 ${winner.name} wins!`}
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
          <div className="muted" style={{ fontWeight: 800, marginBottom: 6 }}>
            🂠 Draw pile · {drawPile.length} cards (top first)
          </div>
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
