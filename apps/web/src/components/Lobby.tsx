import { AnimatePresence, motion } from 'framer-motion';
import { RULES, type ClientGameView, type ClientMessage } from '@ek/shared';

interface LobbyProps {
  view: ClientGameView;
  send: (msg: ClientMessage) => void;
}

export function Lobby({ view, send }: LobbyProps) {
  const me = view.players.find((p) => p.id === view.youId);
  const isHost = view.youId === view.hostId;
  const enough = view.players.length >= RULES.minPlayers;

  return (
    <div className="center-page">
      <div className="panel" style={{ width: 'min(520px, 100%)' }}>
        <h1 className="title" style={{ fontSize: 40 }}>
          Lobby
        </h1>
        <div className="row" style={{ justifyContent: 'center', marginBottom: 18 }}>
          <span className="muted">Room code</span>
          <span className="code-pill">{view.roomCode}</span>
          <button
            className="ghost"
            onClick={() => navigator.clipboard?.writeText(view.roomCode)}
            title="Copy code"
          >
            📋
          </button>
        </div>

        <div className="stack" style={{ marginBottom: 18 }}>
          <AnimatePresence>
            {view.players.map((p) => (
              <motion.div
                key={p.id}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  background: 'var(--panel)',
                  borderRadius: 14,
                  padding: '10px 16px',
                }}
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 30 }}
                layout
              >
                <span style={{ fontWeight: 800 }}>
                  {p.id === view.youId ? '🫵 ' : '🐱 '}
                  {p.name}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  {p.isHost && <span className="badge host">HOST</span>}
                  {p.ready ? (
                    <span className="badge ready">READY</span>
                  ) : (
                    <span className="badge">…</span>
                  )}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <p className="muted" style={{ textAlign: 'center' }}>
          {view.players.length}/{RULES.maxPlayers} players · need {RULES.minPlayers}+ to start
        </p>

        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button
            className="secondary"
            onClick={() => send({ t: 'set_ready', ready: !me?.ready })}
          >
            {me?.ready ? 'Not ready' : "I'm ready"}
          </button>
          {isHost && (
            <button disabled={!enough} onClick={() => send({ t: 'start_game' })}>
              🚀 Start game
            </button>
          )}
        </div>
        {!isHost && (
          <p className="muted" style={{ textAlign: 'center', marginTop: 10 }}>
            Waiting for the host to start…
          </p>
        )}
      </div>
    </div>
  );
}
