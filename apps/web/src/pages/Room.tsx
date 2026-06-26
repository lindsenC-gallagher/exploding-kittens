import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameSocket, type UseGameSocket } from '../hooks/useGameSocket.js';
import { getName, getPlayerId, normalizeName, setName as persistName } from '../lib/identity.js';
import { Lobby } from '../components/Lobby.js';
import { GameTable } from '../components/GameTable.js';
import { SpectatorView } from '../components/SpectatorView.js';
import { WaitingRoom } from '../components/WaitingRoom.js';
import { HelpButton } from '../components/Help.js';
import { ChangelogButton } from '../components/Changelog.js';
import { ExplosionFlash } from '../components/Overlays.js';
import { startMusic, stopMusic } from '../lib/sound.js';
import { ThemeContext } from '../theme.js';

/** How long to dwell on the explosion before flipping the player to spectating. */
const EXPLOSION_HOLD_MS = 2800;

export function Room() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const spectate = searchParams.get('spectate') === '1';
  const pid = getPlayerId();
  const [name, setName] = useState(getName());
  const [nameInput, setNameInput] = useState('');

  // Spectators watch without a seat, so they skip the name gate entirely.
  if (spectate) {
    return <ConnectedRoom code={code} pid={pid} name={name || 'Spectator'} spectate onLeave={() => navigate('/')} />;
  }

  // Require a name before connecting.
  if (!name) {
    return (
      <div className="center-page">
        <div className="panel" style={{ width: 'min(380px,100%)' }}>
          <h2 className="title" style={{ fontSize: 28 }}>
            Joining {code}
          </h2>
          <div className="stack">
            <input
              autoFocus
              placeholder="Your name"
              maxLength={20}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nameInput.trim()) {
                  persistName(nameInput);
                  setName(normalizeName(nameInput));
                }
              }}
            />
            <button
              disabled={!nameInput.trim()}
              onClick={() => {
                persistName(nameInput);
                setName(nameInput.trim());
              }}
            >
              Join game
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <ConnectedRoom code={code} pid={pid} name={name} onLeave={() => navigate('/')} />;
}

function ConnectedRoom({
  code,
  pid,
  name,
  spectate = false,
  onLeave,
}: {
  code: string;
  pid: string;
  name: string;
  spectate?: boolean;
  onLeave: () => void;
}) {
  const sock = useGameSocket(code, pid, name, spectate);

  // Cute, theme-aware background music while in the room (silent when muted).
  const musicTheme = sock.view?.options.theme ?? 'cats';
  useEffect(() => {
    startMusic(musicTheme);
    return () => stopMusic();
  }, [musicTheme]);

  if (!sock.view) {
    return (
      <div className="center-page">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
          style={{ fontSize: 48 }}
        >
          🐾
        </motion.div>
      </div>
    );
  }

  return (
    <ThemeContext.Provider value={sock.view.options.theme ?? 'cats'}>
      <AnimatePresence>
        {sock.error && (
          <motion.div
            key={sock.error}
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            style={{
              position: 'fixed',
              top: 16,
              left: '50%',
              zIndex: 100,
              background: 'var(--danger)',
              padding: '10px 18px',
              borderRadius: 12,
              fontWeight: 800,
            }}
          >
            {sock.error}
          </motion.div>
        )}
      </AnimatePresence>

      {!sock.connected && (
        <div style={{ position: 'fixed', top: 8, left: 8, zIndex: 100 }} className="badge">
          reconnecting…
        </div>
      )}

      <HelpButton view={sock.view} />
      <ChangelogButton right={168} />

      {sock.view.isWaiting ? (
        <WaitingRoom view={sock.view} onLeave={onLeave} />
      ) : sock.view.isSpectator ? (
        <SpectatorOrExplosion sock={sock} onLeave={onLeave} />
      ) : sock.view.phase === 'lobby' ? (
        <Lobby view={sock.view} send={sock.send} />
      ) : (
        <GameTable sock={sock} onLeave={onLeave} />
      )}
    </ThemeContext.Provider>
  );
}

/**
 * Spectator screen, but with a short "you blew up" beat first when this player
 * just exploded. The server flips us straight to spectating the instant the
 * Exploding Kitten goes off, which would otherwise cut the explosion short. So
 * when the most recent events include an `exploded` for *us*, we hold on the
 * ExplosionFlash for a moment before revealing the spectator view. We only
 * delay for our own fresh explosion — not for waiting/watching, or for an
 * already-out player who reconnects into a game in progress.
 */
function SpectatorOrExplosion({ sock, onLeave }: { sock: UseGameSocket; onLeave: () => void }) {
  const view = sock.view!;
  const youId = view.youId;
  const [exploding, setExploding] = useState(false);
  // Each explosion beat fires exactly once: we remember the event-batch id that
  // triggered it so a re-render with the same batch can't re-arm the timer.
  const handledEventId = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const batch = sock.lastEvents;
    if (!batch || batch.id === handledEventId.current) return;
    const iExploded = batch.events.some((e) => e.type === 'exploded' && e.playerId === youId);
    if (!iExploded) return;
    handledEventId.current = batch.id;
    setExploding(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setExploding(false), EXPLOSION_HOLD_MS);
  }, [sock.lastEvents, youId]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (exploding) {
    return (
      <div className="center-page">
        <ExplosionFlash show />
        <motion.div
          className="title"
          style={{ position: 'fixed', bottom: '22%', left: 0, right: 0, textAlign: 'center', fontSize: 36 }}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4, type: 'spring', stiffness: 220, damping: 14 }}
        >
          💥 You exploded!
        </motion.div>
      </div>
    );
  }

  return <SpectatorView view={view} send={sock.send} lastEvents={sock.lastEvents} onLeave={onLeave} />;
}
