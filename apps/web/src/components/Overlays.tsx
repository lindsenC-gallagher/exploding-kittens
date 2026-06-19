import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  cardNames,
  type Card as CardModel,
  type ClientGameView,
  type ClientMessage,
  type ComboKind,
} from '@ek/shared';
import { Card, CardBack } from './Card.js';
import { useTheme } from '../theme.js';

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
  const theme = useTheme();
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
            {theme === 'dogs' ? '💥🐶' : '💥🙀'}
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

function comboLabel(combo?: ComboKind): string | null {
  switch (combo) {
    case 'pair':
      return 'Pair · blind steal';
    case 'triple':
      return 'Triple · demand a card';
    case 'five_different':
      return 'Five different · take from discard';
    default:
      return null;
  }
}

export interface PlayedBannerData {
  id: number;
  byName: string;
  /** Name of the targeted player, when the action is aimed at someone. */
  targetName?: string;
  cards: CardModel[];
  combo?: ComboKind;
  /**
   * Where to pin the banner relative to the player who played. `x`/`y` are the
   * viewport-anchor point (centre-x of the player, and the edge of their box);
   * `placement` says whether the banner sits below the anchor (arrow points up
   * at a top-of-table opponent) or above it (arrow points down at your hand).
   * Null falls back to the old centred-near-top position.
   */
  pos?: { x: number; y: number; placement: 'above' | 'below' } | null;
}

/**
 * Big, transient "X played Y" announcement, pinned just under (or above) the
 * player who played with an arrow pointing at them, so it's obvious who did
 * what. Auto-dismissed by the parent after a few seconds. Non-interactive
 * (pointer-events: none) so it never blocks the table beneath.
 */
export function PlayedBanner({ banner }: { banner: PlayedBannerData | null }) {
  const pos = banner?.pos ?? null;
  // Centering is done via framer's own x/y transform (not CSS transform), so it
  // composes with the scale animation instead of being clobbered by it.
  const above = !pos || pos.placement === 'above';
  const style: CSSProperties = pos
    ? { left: pos.x, top: above ? pos.y - 16 : pos.y + 16 }
    : { left: '50%', top: '16%' };
  const tx = '-50%';
  const ty = above ? '-100%' : '0%';
  return (
    <AnimatePresence>
      {banner && (
        <motion.div
          key={banner.id}
          className="played-banner"
          style={style}
          initial={{ opacity: 0, scale: 0.7, x: tx, y: ty }}
          animate={{ opacity: 1, scale: 1, x: tx, y: ty }}
          exit={{ opacity: 0, scale: 1.1, x: tx, y: ty }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        >
          {pos && <div className={`played-arrow ${pos.placement === 'below' ? 'up' : 'down'}`} />}
          <div className="played-by">🃏 {banner.byName} played</div>
          <div className="played-cards">
            {banner.cards.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ rotate: -6, y: 50, opacity: 0 }}
                animate={{ rotate: (i - (banner.cards.length - 1) / 2) * 7, y: 0, opacity: 1 }}
                transition={{ delay: 0.05 + i * 0.08, type: 'spring', stiffness: 300, damping: 20 }}
              >
                <Card type={c.type} />
              </motion.div>
            ))}
          </div>
          {comboLabel(banner.combo) && <div className="played-combo">{comboLabel(banner.combo)}</div>}
          {banner.targetName && <div className="played-target">🎯 targeting {banner.targetName}</div>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface StolenToastData {
  id: number;
  /** True when YOU are the thief; false when you are the victim. */
  mine: boolean;
  /** The other party's name (victim if mine, thief otherwise). */
  otherName: string;
  card: CardModel;
}

/**
 * Toast shown to the two players who know a steal happened: the victim ("X took
 * your Y") and the thief ("You took X's Y"). Others never see which card moved.
 */
export function StolenToast({ toast }: { toast: StolenToastData | null }) {
  const theme = useTheme();
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          className="stolen-toast"
          // x:'-50%' centers via framer's transform (composes with scale); the
          // CSS translateX would otherwise be clobbered by the animation.
          initial={{ opacity: 0, y: -40, scale: 0.8, x: '-50%' }}
          animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
          exit={{ opacity: 0, y: -30, scale: 0.9, x: '-50%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        >
          <div className="stolen-text">
            {toast.mine ? (
              <>
                🦝 You stole <b>{cardNames(theme)[toast.card.type]}</b> from {toast.otherName}!
              </>
            ) : (
              <>
                {theme === 'dogs' ? '😢' : '😿'} {toast.otherName} stole your{' '}
                <b>{cardNames(theme)[toast.card.type]}</b>!
              </>
            )}
          </div>
          <Card type={toast.card.type} small />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface FlyingCard {
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * Overlay layer that animates a card-back travelling from the draw pile to a
 * player (your hand, or an opponent up top) when a card is drawn. Purely
 * decorative and non-interactive.
 */
export function FlyingCards({ cards }: { cards: FlyingCard[] }) {
  return (
    <div className="flying-layer">
      <AnimatePresence>
        {cards.map((fc) => (
          <motion.div
            key={fc.id}
            className="flying-card"
            initial={{ x: fc.from.x, y: fc.from.y, scale: 0.55, opacity: 0, rotate: -8 }}
            animate={{
              x: fc.to.x,
              y: fc.to.y,
              scale: [0.55, 0.8, 0.7],
              opacity: [0, 1, 1, 0.85],
              rotate: [-8, 6, 0],
            }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.65, ease: 'easeInOut' }}
          >
            <CardBack />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export interface DrawRevealData {
  id: number;
  /** Viewport top-left of the draw pile (the card starts here). */
  from: { x: number; y: number };
  /** Viewport top-left of the card's destination slot in your hand. */
  to: { x: number; y: number };
  type: CardModel['type'];
}

/**
 * The drawer's private "reveal": the card they just drew appears face up over
 * the draw pile, then glides to the exact slot it lands in within their hand
 * (the real hand card stays hidden until this finishes). Only the drawing
 * player ever sees it face up; others see a face-down {@link FlyingCards} card.
 */
export function DrawReveal({ reveal }: { reveal: DrawRevealData | null }) {
  return (
    <div className="flying-layer">
      <AnimatePresence>
        {reveal && (
          <motion.div
            key={reveal.id}
            className="draw-reveal"
            initial={{ x: reveal.from.x, y: reveal.from.y, scale: 0.7, opacity: 0 }}
            animate={{
              x: [reveal.from.x, reveal.from.x, reveal.to.x],
              y: [reveal.from.y, reveal.from.y, reveal.to.y],
              scale: [0.7, 1.06, 1],
              opacity: [0, 1, 1],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.82, times: [0, 0.34, 1], ease: 'easeInOut' }}
          >
            <Card type={reveal.type} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** End-of-game winner screen. */
export function WinScreen({
  view,
  send,
  onLeave,
}: {
  view: ClientGameView;
  send: (msg: ClientMessage) => void;
  onLeave: () => void;
}) {
  const theme = useTheme();
  if (view.phase !== 'gameOver') return null;
  const winner = view.players.find((p) => p.id === view.winnerId);
  const youWon = view.winnerId === view.youId;
  const isHost = view.youId === view.hostId;
  const dogs = theme === 'dogs';
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
          {youWon ? (dogs ? '🏆🐶' : '🏆🐱') : dogs ? '🐶' : '🙀'}
        </motion.div>
        <h1 className="title">{youWon ? 'You survived!' : `${winner?.name ?? 'Someone'} wins!`}</h1>
        <p className="muted">The last {dogs ? 'pup' : 'kitty'} standing takes it all.</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          {isHost ? (
            <button onClick={() => send({ t: 'play_again' })}>🔄 Play again</button>
          ) : (
            <span className="muted">Waiting for the host to start a new game…</span>
          )}
          <button className="secondary" onClick={onLeave}>
            Back to home
          </button>
        </div>
      </motion.div>
    </div>
  );
}
