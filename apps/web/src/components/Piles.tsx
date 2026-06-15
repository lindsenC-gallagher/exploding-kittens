import { AnimatePresence, motion } from 'framer-motion';
import type { ClientGameView } from '@ek/shared';
import { Card, CardBack } from './Card.js';

interface PilesProps {
  view: ClientGameView;
  canDraw: boolean;
  onDraw: () => void;
}

export function Piles({ view, canDraw, onDraw }: PilesProps) {
  return (
    <div className="center-area">
      <div className="pile">
        <span className="muted">Discard</span>
        <div style={{ position: 'relative', width: 'var(--card-w)', height: 'var(--card-h)' }}>
          <AnimatePresence mode="popLayout">
            {view.discardTop ? (
              <motion.div
                key={view.discardTop.id}
                initial={{ scale: 0.6, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ position: 'absolute', inset: 0 }}
              >
                <Card type={view.discardTop.type} />
              </motion.div>
            ) : (
              <div className="card" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--muted)' }}>
                <span className="name">empty</span>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="pile">
        <span className="muted">Draw pile</span>
        <motion.div
          id="draw-anchor"
          whileHover={canDraw ? { y: -10, scale: 1.05 } : undefined}
          whileTap={canDraw ? { scale: 0.96 } : undefined}
          style={{ cursor: canDraw ? 'pointer' : 'default' }}
          onClick={canDraw ? onDraw : undefined}
        >
          <CardBack count={view.drawPileCount} />
        </motion.div>
        {canDraw && <span className="badge ready">Click to draw</span>}
      </div>
    </div>
  );
}
