import { motion } from 'framer-motion';
import type { ClientGameView } from '@ek/shared';

/**
 * Holding screen for someone who reached a room while a game is already in
 * progress. They were not dealt into the current game, so they see NO hidden
 * info (no hands, no deck) — just a friendly "wait for the next game" message.
 * The server seats them automatically when the host starts a new game; at that
 * point their view stops being `isWaiting` and the lobby/table takes over.
 */
export function WaitingRoom({ view, onLeave }: { view: ClientGameView; onLeave: () => void }) {
  const playing = view.players.filter((p) => p.alive).length;
  return (
    <div className="center-page">
      <div className="panel" style={{ width: 'min(420px,100%)', textAlign: 'center' }}>
        <motion.div
          animate={{ rotate: [0, -8, 8, 0] }}
          transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
          style={{ fontSize: 56 }}
        >
          ⏳
        </motion.div>
        <h2 className="title" style={{ fontSize: 26 }}>
          A game is in progress
        </h2>
        <p className="muted" style={{ marginTop: 4 }}>
          You&apos;ll join the next game automatically. Room <b>{view.roomCode}</b>
          {playing > 0 && ` · ${playing} ${playing === 1 ? 'player' : 'players'} still in`}.
        </p>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Sit tight — when the host starts a fresh game you&apos;ll be dealt in.
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="ghost" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
