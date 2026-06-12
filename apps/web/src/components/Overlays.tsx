import { AnimatePresence, motion } from 'framer-motion';
import type { Card as CardModel, ClientGameView } from '@ek/shared';
import { Card } from './Card.js';

/** Big "NOPE!" stamp that slams onto the screen. */
export function NopeStamp({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="nope-stamp"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="stamp"
            initial={{ scale: 3, rotate: -40, opacity: 0 }}
            animate={{ scale: 1, rotate: -12, opacity: 1 }}
            exit={{ scale: 1.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
          >
            NOPE!
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Full-screen explosion flash. */
export function ExplosionFlash({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="nope-stamp"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ scale: 0, rotate: 0 }}
            animate={{ scale: [0, 1.6, 1.2], rotate: [0, 20, -10, 0] }}
            transition={{ duration: 0.8 }}
            style={{ fontSize: 160 }}
          >
            💥🙀
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Private See the Future modal showing the top 3 cards. */
export function SeeFutureModal({ cards, onClose }: { cards: CardModel[] | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {cards && (
        <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className="modal"
            initial={{ scale: 0.8, y: 30 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0 }}
          >
            <h2 className="title" style={{ fontSize: 28 }}>
              🔮 The Future
            </h2>
            <p className="muted">Top of the draw pile (only you can see this):</p>
            <div className="row" style={{ justifyContent: 'center', margin: '20px 0' }}>
              {cards.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ rotateY: 180, opacity: 0 }}
                  animate={{ rotateY: 0, opacity: 1 }}
                  transition={{ delay: i * 0.2 }}
                >
                  <div className="badge" style={{ marginBottom: 6 }}>
                    {i === 0 ? 'next' : `+${i}`}
                  </div>
                  <Card type={c.type} />
                </motion.div>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button onClick={onClose}>Got it</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** End-of-game winner screen. */
export function WinScreen({ view, onLeave }: { view: ClientGameView; onLeave: () => void }) {
  if (view.phase !== 'gameOver') return null;
  const winner = view.players.find((p) => p.id === view.winnerId);
  const youWon = view.winnerId === view.youId;
  return (
    <div className="overlay">
      <motion.div
        className="modal"
        style={{ textAlign: 'center' }}
        initial={{ scale: 0.6, y: 40 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 16 }}
      >
        <motion.div
          style={{ fontSize: 90 }}
          animate={{ rotate: [0, -10, 10, 0], y: [0, -10, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          {youWon ? '🏆🐱' : '🙀'}
        </motion.div>
        <h1 className="title">{youWon ? 'You survived!' : `${winner?.name ?? 'Someone'} wins!`}</h1>
        <p className="muted">The last kitty standing takes it all.</p>
        <button onClick={onLeave} style={{ marginTop: 16 }}>
          Back to home
        </button>
      </motion.div>
    </div>
  );
}
