import { motion } from 'framer-motion';
import type { ClientGameView } from '@ek/shared';

/**
 * The bigger player cards, shown in turn order and rotated so the *current*
 * player always sits first (top-left) — no matter whose point of view this is.
 * The rest follow in upcoming-turn order and wrap around, with arrows between
 * cards showing the direction of play. This doubles as the turn-order display,
 * so the active player is always visible at the top.
 */
export function Opponents({ view }: { view: ClientGameView }) {
  const players = view.players;
  if (players.length === 0) return null;
  // Rotate the seat array so the current player is index 0; the others trail in
  // the order they'll take their turns. Falls back to seat order if there's no
  // current player (e.g. before the game starts).
  const found = players.findIndex((p) => p.id === view.currentPlayerId);
  const start = found < 0 ? 0 : found;
  const ordered = players.map((_, i) => players[(start + i) % players.length]);

  return (
    <div className="opponents" aria-label="Players in turn order">
      {ordered.map((p, i) => {
        const active = view.currentPlayerId === p.id;
        const isYou = p.id === view.youId;
        return (
          <div key={p.id} className="opponent-row">
            <motion.div
              id={`opp-anchor-${p.id}`}
              className={`opponent ${active ? 'active' : ''} ${p.alive ? '' : 'dead'}`}
              layout
              animate={active ? { scale: [1, 1.05, 1] } : { scale: 1 }}
              transition={{ duration: 0.6, repeat: active ? Infinity : 0 }}
            >
              <div style={{ fontSize: 26 }}>{p.alive ? p.avatar : '💀'}</div>
              <div style={{ fontWeight: 800 }}>
                {p.name}
                {isYou ? ' (you)' : ''}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                🃏 {p.handCount} {!p.connected && '· offline'}
              </div>
              {active && p.alive && (
                <div className="badge" style={{ marginTop: 4 }}>
                  turn{view.turnsRemaining > 1 ? ` ×${view.turnsRemaining}` : ''}
                </div>
              )}
            </motion.div>
            {i < ordered.length - 1 && (
              <span className="turn-order-arrow" aria-hidden>
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
