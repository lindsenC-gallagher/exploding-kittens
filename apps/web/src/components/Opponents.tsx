import { motion } from 'framer-motion';
import type { ClientGameView } from '@ek/shared';

export function Opponents({ view }: { view: ClientGameView }) {
  const others = view.players.filter((p) => p.id !== view.youId);
  return (
    <div className="opponents">
      {others.map((p) => {
        const active = view.currentPlayerId === p.id;
        return (
          <motion.div
            key={p.id}
            id={`opp-anchor-${p.id}`}
            className={`opponent ${active ? 'active' : ''} ${p.alive ? '' : 'dead'}`}
            layout
            animate={active ? { scale: [1, 1.05, 1] } : { scale: 1 }}
            transition={{ duration: 0.6, repeat: active ? Infinity : 0 }}
          >
            <div style={{ fontSize: 26 }}>{p.alive ? '🐱' : '💀'}</div>
            <div style={{ fontWeight: 800 }}>{p.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              🃏 {p.handCount} {!p.connected && '· offline'}
            </div>
            {active && p.alive && (
              <div className="badge" style={{ marginTop: 4 }}>
                turn{view.turnsRemaining > 1 ? ` ×${view.turnsRemaining}` : ''}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
