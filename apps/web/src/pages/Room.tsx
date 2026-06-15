import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameSocket } from '../hooks/useGameSocket.js';
import { getName, getPlayerId, normalizeName, setName as persistName } from '../lib/identity.js';
import { Lobby } from '../components/Lobby.js';
import { GameTable } from '../components/GameTable.js';
import { HelpButton } from '../components/Help.js';

export function Room() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const pid = getPlayerId();
  const [name, setName] = useState(getName());
  const [nameInput, setNameInput] = useState('');

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
  onLeave,
}: {
  code: string;
  pid: string;
  name: string;
  onLeave: () => void;
}) {
  const sock = useGameSocket(code, pid, name);

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
    <>
      <AnimatePresence>
        {sock.error && (
          <motion.div
            key={sock.error}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: 'fixed',
              top: 16,
              left: '50%',
              transform: 'translateX(-50%)',
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

      <HelpButton playerCount={sock.view.players.length} />

      {sock.view.phase === 'lobby' ? (
        <Lobby view={sock.view} send={sock.send} />
      ) : (
        <GameTable sock={sock} onLeave={onLeave} />
      )}
    </>
  );
}
