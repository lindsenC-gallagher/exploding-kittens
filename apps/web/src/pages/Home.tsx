import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { createRoom } from '../lib/api.js';
import { getName, setName as persistName } from '../lib/identity.js';
import { ChangelogButton } from '../components/Changelog.js';

export function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState(getName());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim().length > 0;

  async function handleCreate() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      persistName(name);
      const roomCode = await createRoom();
      navigate(`/room/${roomCode}`);
    } catch {
      setError('Could not create a game. Is the server running?');
      setBusy(false);
    }
  }

  function handleJoin() {
    if (!ready || code.trim().length < 3) return;
    persistName(name);
    navigate(`/room/${code.trim().toUpperCase()}`);
  }

  function handleWatch() {
    if (code.trim().length < 3) return;
    navigate(`/room/${code.trim().toUpperCase()}?spectate=1`);
  }

  return (
    <div className="center-page">
      <ChangelogButton />
      <motion.div
        className="panel"
        style={{ width: 'min(440px, 100%)' }}
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      >
        <motion.h1
          className="title"
          animate={{ rotate: [0, -2, 2, 0] }}
          transition={{ repeat: Infinity, duration: 6, ease: 'easeInOut' }}
        >
          Exploding Kittens
        </motion.h1>
        <p className="subtitle">A kitty-powered game of luck, betrayal & explosions 🙀💥</p>

        <div className="stack">
          <label className="stack" style={{ gap: 6 }}>
            <span className="muted">Your name</span>
            <input
              value={name}
              maxLength={20}
              placeholder="e.g. Whiskers"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <button disabled={!ready || busy} onClick={handleCreate}>
            {busy ? 'Creating…' : '🎲 Create a game'}
          </button>

          <div className="row" style={{ margin: '6px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--panel-border)' }} />
            <span className="muted">or join</span>
            <div style={{ flex: 1, height: 1, background: 'var(--panel-border)' }} />
          </div>

          <div className="row">
            <input
              value={code}
              placeholder="ROOM CODE"
              maxLength={6}
              style={{ flex: 1, textTransform: 'uppercase', letterSpacing: 4 }}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
            <button className="secondary" disabled={!ready || code.trim().length < 3} onClick={handleJoin}>
              Join
            </button>
          </div>

          <button className="ghost" disabled={code.trim().length < 3} onClick={handleWatch}>
            👁 Watch a game (spectate)
          </button>

          {error && <p className="error">{error}</p>}
        </div>
      </motion.div>
    </div>
  );
}
