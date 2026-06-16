/**
 * Tiny WebAudio sound-effects engine. Sounds are synthesized on the fly (short
 * oscillator blips with envelopes) so there are no audio assets to ship and it
 * works offline. A single AudioContext is created lazily on first use — by then
 * the player has already clicked (to join/start), satisfying the autoplay gate.
 *
 * Mute state is persisted in localStorage and exposed via a tiny subscribe API
 * so a React control can reflect/toggle it.
 */

export type SoundName =
  | 'play'
  | 'draw'
  | 'nope'
  | 'explode'
  | 'defuse'
  | 'steal'
  | 'shuffle'
  | 'future'
  | 'turn'
  | 'win'
  | 'click';

const MUTE_KEY = 'ek_muted';

let ctx: AudioContext | null = null;
const listeners = new Set<(muted: boolean) => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

let muted = readMuted();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* storage unavailable — keep the in-memory flag */
  }
  for (const l of listeners) l(next);
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

/** Subscribe to mute changes; returns an unsubscribe fn. */
export function onMuteChange(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // A context can start suspended until a gesture; resume best-effort.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface Blip {
  freq: number;
  /** Seconds from the cue at which this blip starts. */
  at?: number;
  dur?: number;
  type?: OscillatorType;
  /** Peak gain (0..1). */
  gain?: number;
  /** Optional linear glide to this frequency over the blip's duration. */
  slideTo?: number;
}

function blip(ac: AudioContext, start: number, b: Blip): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  const t0 = start + (b.at ?? 0);
  const dur = b.dur ?? 0.12;
  const peak = b.gain ?? 0.18;
  osc.type = b.type ?? 'triangle';
  osc.frequency.setValueAtTime(b.freq, t0);
  if (b.slideTo) osc.frequency.linearRampToValueAtTime(b.slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Each sound is a small chord/arpeggio recipe. */
const RECIPES: Record<SoundName, Blip[]> = {
  click: [{ freq: 420, dur: 0.05, gain: 0.1, type: 'square' }],
  play: [
    { freq: 523, dur: 0.1 },
    { freq: 784, at: 0.06, dur: 0.12 },
  ],
  draw: [{ freq: 330, slideTo: 560, dur: 0.16, type: 'sine', gain: 0.16 }],
  turn: [
    { freq: 660, dur: 0.1, type: 'sine' },
    { freq: 880, at: 0.08, dur: 0.12, type: 'sine' },
  ],
  nope: [{ freq: 300, slideTo: 120, dur: 0.28, type: 'sawtooth', gain: 0.2 }],
  explode: [
    { freq: 180, slideTo: 60, dur: 0.5, type: 'sawtooth', gain: 0.28 },
    { freq: 90, slideTo: 40, dur: 0.5, type: 'square', gain: 0.2 },
  ],
  defuse: [
    { freq: 392, dur: 0.1, type: 'sine' },
    { freq: 523, at: 0.09, dur: 0.1, type: 'sine' },
    { freq: 659, at: 0.18, dur: 0.16, type: 'sine' },
  ],
  steal: [{ freq: 700, slideTo: 1100, dur: 0.14, type: 'triangle', gain: 0.16 }],
  shuffle: [
    { freq: 400, dur: 0.05, type: 'square', gain: 0.08 },
    { freq: 520, at: 0.05, dur: 0.05, type: 'square', gain: 0.08 },
    { freq: 460, at: 0.1, dur: 0.05, type: 'square', gain: 0.08 },
    { freq: 600, at: 0.15, dur: 0.06, type: 'square', gain: 0.08 },
  ],
  future: [
    { freq: 880, dur: 0.12, type: 'sine', gain: 0.12 },
    { freq: 1175, at: 0.1, dur: 0.14, type: 'sine', gain: 0.12 },
  ],
  win: [
    { freq: 523, dur: 0.14, type: 'square', gain: 0.16 },
    { freq: 659, at: 0.14, dur: 0.14, type: 'square', gain: 0.16 },
    { freq: 784, at: 0.28, dur: 0.14, type: 'square', gain: 0.16 },
    { freq: 1047, at: 0.42, dur: 0.26, type: 'square', gain: 0.18 },
  ],
};

export function playSound(name: SoundName): void {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const start = ac.currentTime + 0.01;
  for (const b of RECIPES[name]) blip(ac, start, b);
}
