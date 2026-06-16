import { AnimatePresence, motion } from 'framer-motion';
import { AVATARS, RULES, type ClientGameView, type ClientMessage } from '@ek/shared';

interface LobbyProps {
  view: ClientGameView;
  send: (msg: ClientMessage) => void;
}

/** Toggleable combo rules, with the example "5-card rule" called out. */
const RULE_TOGGLES: { key: keyof ClientGameView['options']; label: string; hint: string }[] = [
  { key: 'allowPairSteal', label: 'Pairs', hint: 'Two matching cards → blind-steal a random card.' },
  { key: 'allowTripleDemand', label: 'Three of a kind', hint: 'Name a card and take it if they have it.' },
  {
    key: 'allowFiveDifferent',
    label: 'Five different',
    hint: 'Take any card from the discard (the “5-card rule”).',
  },
];

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
                  <span style={{ fontSize: 20, marginRight: 6 }}>{p.avatar}</span>
                  {p.name}
                  {p.id === view.youId ? ' (you)' : ''}
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

        <div className="avatar-panel">
          <div className="muted" style={{ fontWeight: 800, marginBottom: 8 }}>
            🎭 Choose your avatar
          </div>
          <div className="avatar-grid">
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                className={`avatar-pick ${me?.avatar === a ? 'on' : ''}`}
                aria-pressed={me?.avatar === a}
                onClick={() => send({ t: 'set_avatar', avatar: a })}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        <div className="rules-panel">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 800 }}>🛠️ House rules</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {isHost ? 'Tap to toggle' : 'Set by the host'}
            </span>
          </div>
          {RULE_TOGGLES.map((r) => {
            const on = view.options[r.key];
            return (
              <button
                key={r.key}
                type="button"
                className="rule-toggle"
                disabled={!isHost}
                aria-pressed={on}
                onClick={isHost ? () => send({ t: 'set_options', options: { [r.key]: !on } }) : undefined}
              >
                <span className={`rule-switch ${on ? 'on' : ''}`} aria-hidden>
                  <span className="rule-knob" />
                </span>
                <span className="rule-text">
                  <span className="rule-name">{r.label}</span>
                  <span className="rule-hint">{r.hint}</span>
                </span>
                <span className={`rule-state ${on ? 'on' : ''}`}>{on ? 'On' : 'Off'}</span>
              </button>
            );
          })}
        </div>

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
