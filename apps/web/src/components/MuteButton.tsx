import { useEffect, useState } from 'react';
import {
  isMusicMuted,
  isSfxMuted,
  onMusicMuteChange,
  onSfxMuteChange,
  playSound,
  toggleMusicMuted,
  toggleSfxMuted,
} from '../lib/sound.js';

/**
 * Two floating toggles in the top-right cluster: one for sound effects
 * (speaker) and one for background music (note). Each reflects and toggles its
 * own independent mute channel.
 */
export function MuteButton() {
  const [sfxMuted, setSfxMuted] = useState(isSfxMuted());
  const [musicMuted, setMusicMuted] = useState(isMusicMuted());
  useEffect(() => onSfxMuteChange(setSfxMuted), []);
  useEffect(() => onMusicMuteChange(setMusicMuted), []);
  return (
    <>
      <button
        className="mute-fab"
        aria-label={sfxMuted ? 'Unmute sound effects' : 'Mute sound effects'}
        aria-pressed={sfxMuted}
        title={sfxMuted ? 'Sound effects off' : 'Sound effects on'}
        onClick={() => {
          const nowMuted = toggleSfxMuted();
          if (!nowMuted) playSound('click'); // confirm effects are back on
        }}
      >
        {sfxMuted ? '🔇' : '🔊'}
      </button>
      <button
        className="music-fab"
        aria-label={musicMuted ? 'Unmute music' : 'Mute music'}
        aria-pressed={musicMuted}
        title={musicMuted ? 'Music off' : 'Music on'}
        onClick={() => toggleMusicMuted()}
      >
        {musicMuted ? '🔕' : '🎵'}
      </button>
    </>
  );
}
