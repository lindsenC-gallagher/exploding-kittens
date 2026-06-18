import { motion } from 'framer-motion';
import type { ClientGameView } from '@ek/shared';

/**
 * The bigger player cards, shown in fixed seat order so each player keeps the
 * same position no matter whose turn it is or whose point of view this is. The
 * active player is marked with a highlight + turn badge, and arrows between
 * cards show the direction of play. This doubles as the turn-order display.
 */
export function Opponents({ view }: { view: ClientGameView }) {
  const ordered = view.players;
  if (ordered.length === 0) return null;

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
