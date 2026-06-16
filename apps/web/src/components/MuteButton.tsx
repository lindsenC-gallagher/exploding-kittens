import { useEffect, useState } from 'react';
import { isMuted, onMuteChange, playSound, toggleMuted } from '../lib/sound.js';

/** Floating speaker toggle that mutes/unmutes all game sound effects. */
export function MuteButton() {
  const [muted, setMuted] = useState(isMuted());
  useEffect(() => onMuteChange(setMuted), []);
  return (
    <button
      className="mute-fab"
      aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
      aria-pressed={muted}
      title={muted ? 'Sound off' : 'Sound on'}
      onClick={() => {
        const nowMuted = toggleMuted();
        if (!nowMuted) playSound('click'); // confirm audio is back on
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
