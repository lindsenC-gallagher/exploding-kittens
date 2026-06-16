import { motion } from 'framer-motion';
import type { ClientGameView } from '@ek/shared';

/**
 * Compact strip showing every player in seat order with the current player
 * highlighted, so the turn order (and whose turn it is) is always visible at a
 * glance. Arrows between chips show the direction play moves.
 */
export function TurnOrder({ view }: { view: ClientGameView }) {
  if (view.phase !== 'playing') return null;
  const players = view.players;
  return (
    <div className="turn-order" aria-label="Turn order">
      {players.map((p, i) => {
        const active = view.currentPlayerId === p.id;
        const isYou = p.id === view.youId;
        return (
          <div key={p.id} className="turn-order-row">
            <motion.div
              className={`turn-chip ${active ? 'active' : ''} ${p.alive ? '' : 'dead'}`}
              animate={active ? { scale: [1, 1.06, 1] } : { scale: 1 }}
              transition={{ duration: 0.9, repeat: active ? Infinity : 0 }}
              title={isYou ? `${p.name} (you)` : p.name}
            >
              <span className="turn-chip-avatar">{p.alive ? p.avatar : '💀'}</span>
              <span className="turn-chip-name">
                {p.name}
                {isYou ? ' (you)' : ''}
              </span>
              {active && p.alive && view.turnsRemaining > 1 && (
                <span className="turn-chip-badge">×{view.turnsRemaining}</span>
              )}
            </motion.div>
            {i < players.length - 1 && <span className="turn-order-arrow">→</span>}
          </div>
        );
      })}
      <span className="turn-order-arrow loop" title="play wraps around">↻</span>
    </div>
  );
}
