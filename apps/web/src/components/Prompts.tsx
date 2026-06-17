import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import {
  CARD_NAMES,
  CAT_CARDS,
  CardType,
  cardNames,
  type Card as CardModel,
  type ClientGameView,
} from '@ek/shared';
import { Card, CardBack } from './Card.js';
import { useTheme } from '../theme.js';

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overlay">
      <motion.div
        className="modal"
        initial={{ scale: 0.85, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
      >
        {children}
      </motion.div>
    </div>
  );
}

/**
 * Draw revealed an Exploding Kitten. The Defuse is mandatory and fires
 * automatically — the player's only decision is *where* to secretly slip the
 * kitten back into the deck. The deck is shown as an overlapping fan; drag the
 * kitten across it and drop to bury it anywhere, or use the Top/Middle/Bottom
 * shortcuts. Positions are 0..drawPileCount (0 = top, next to be drawn).
 */
export function DefusePrompt({
  view,
  defuseCardId,
  onDefuse,
}: {
  view: ClientGameView;
  defuseCardId: string;
  onDefuse: (cardId: string, insertPosition: number) => void;
}) {
  const max = view.drawPileCount;
  const dogs = view.options.theme === 'dogs';
  const deckRef = useRef<HTMLDivElement>(null);
  const [deckW, setDeckW] = useState(0);
  const [pos, setPos] = useState(() => Math.floor(max / 2));
  const x = useMotionValue(0);
  const dragging = useRef(false);

  // Measure the deck track so the kitten's x maps onto insertion positions.
  useEffect(() => {
    const measure = () => setDeckW(deckRef.current?.clientWidth ?? 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const xForPos = (p: number) => (max <= 0 || deckW <= 0 ? 0 : (p / max) * deckW);
  const posForX = (px: number) =>
    max <= 0 || deckW <= 0 ? 0 : Math.max(0, Math.min(max, Math.round((px / deckW) * max)));

  // Park the kitten over the current position when not actively dragging.
  useEffect(() => {
    if (!dragging.current) x.set(xForPos(pos));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckW, pos]);

  const commit = (p: number) => onDefuse(defuseCardId, Math.max(0, Math.min(p, max)));

  const BACK_W = 50;
  const backCount = Math.min(Math.max(max, 1), 24); // visual only; mapping uses `max`
  const canDrag = deckW > 0 && max > 0;

  return (
    <ModalShell>
      <h2 className="title" style={{ fontSize: 28 }}>
        🧯 Phew — Defused!
      </h2>
      <p className="muted">
        Your Defuse fired automatically and saved you. Now secretly hide the Exploding{' '}
        {dogs ? 'Puppy' : 'Kitten'} back in the deck — <b>drag it onto the deck and drop</b> to bury
        it anywhere, or tap a shortcut.
      </p>

      <div className="defuse-deck-area">
        <div className="defuse-kitten-track">
          <motion.div
            className="defuse-kitten"
            style={{ x }}
            drag={canDrag ? 'x' : false}
            dragConstraints={{ left: 0, right: deckW }}
            dragElastic={0}
            dragMomentum={false}
            onDragStart={() => {
              dragging.current = true;
            }}
            onDrag={() => setPos(posForX(x.get()))}
            onDragEnd={() => {
              dragging.current = false;
              commit(posForX(x.get()));
            }}
            whileDrag={{ scale: 1.05 }}
          >
            <div className="defuse-kitten-center">
              <Card type={CardType.ExplodingKitten} />
              <div className="defuse-arrow">⬇</div>
            </div>
          </motion.div>
        </div>

        <div className="defuse-deck" ref={deckRef}>
          {Array.from({ length: backCount }).map((_, i) => (
            <div
              className="defuse-deck-card"
              key={i}
              style={{
                left:
                  backCount > 1
                    ? `calc(${(i / (backCount - 1)) * 100}% - ${(i / (backCount - 1)) * BACK_W}px)`
                    : 0,
                zIndex: i,
              }}
            >
              <CardBack />
            </div>
          ))}
          {/* End markers so it's obvious which side is the top vs the bottom. */}
          <div className="defuse-edge left" />
          <div className="defuse-edge right" />
          {canDrag && <motion.div className="defuse-insert-line" style={{ x }} />}
        </div>

        <div className="defuse-ends">
          <span className="defuse-cap top">⬅ TOP · next draw</span>
          <span className="badge">
            position {pos} of {max}
          </span>
          <span className="defuse-cap bottom">BOTTOM ➡</span>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <button onClick={() => commit(0)}>🔝 Top (evil)</button>
        <button className="secondary" onClick={() => commit(Math.floor(max / 2))}>
          📍 Middle
        </button>
        <button className="secondary" onClick={() => commit(max)}>
          Bottom
        </button>
      </div>
    </ModalShell>
  );
}

/**
 * The thief blindly picks one of the target's face-down cards (a faithful pair
 * "random" steal). They only ever see card backs — the pick is pure chance,
 * and the victim may rearrange their hand while this is open.
 */
export function StealPickModal({
  fromName,
  count,
  msUntilPickable,
  onPick,
}: {
  fromName: string;
  count: number;
  /** While > 0, the victim is still rearranging and picking is locked out. */
  msUntilPickable: number;
  onPick: (index: number) => void;
}) {
  const locked = msUntilPickable > 0;
  return (
    <ModalShell>
      <h2 className="title" style={{ fontSize: 26 }}>
        🙈 Blind steal from {fromName}
      </h2>
      {locked ? (
        <p className="muted">
          ⏳ {fromName} is shuffling their hand — you can pick in{' '}
          <b>{Math.ceil(msUntilPickable / 1000)}s</b>.
        </p>
      ) : (
        <p className="muted">
          Their hand is face-down. Pick one — you won&apos;t know what you&apos;re grabbing until
          it&apos;s yours!
        </p>
      )}
      <div
        className="row"
        style={{ flexWrap: 'wrap', justifyContent: 'center', margin: '18px 0', gap: 12 }}
      >
        {count === 0 ? (
          <span className="muted">They have no cards to take.</span>
        ) : (
          Array.from({ length: count }).map((_, i) => (
            <motion.div
              key={i}
              whileHover={locked ? undefined : { y: -12, scale: 1.05 }}
              whileTap={locked ? undefined : { scale: 0.95 }}
              style={locked ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
            >
              <CardBack selectable={!locked} label={`#${i + 1}`} onClick={() => (locked ? undefined : onPick(i))} />
            </motion.div>
          ))
        )}
      </div>
    </ModalShell>
  );
}

/** Target of a Favor must give one card of their choice. */
export function FavorPrompt({
  hand,
  toName,
  onGive,
}: {
  hand: CardModel[];
  toName: string;
  onGive: (cardId: string) => void;
}) {
  return (
    <ModalShell>
      <h2 className="title" style={{ fontSize: 28 }}>
        🎁 Favor
      </h2>
      <p className="muted">{toName} played Favor on you. Choose a card to give:</p>
      <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center', margin: '16px 0', gap: 8 }}>
        {hand.map((c) => (
          <div key={c.id} onClick={() => onGive(c.id)}>
            <Card type={c.type} selectable />
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

/** Pick which opponent to target (Favor / pair / triple). */
export function TargetPicker({
  view,
  title,
  onPick,
  onCancel,
}: {
  view: ClientGameView;
  title: string;
  onPick: (playerId: string) => void;
  onCancel: () => void;
}) {
  const targets = view.players.filter((p) => p.id !== view.youId && p.alive);
  const pawFace = view.options.theme === 'dogs' ? '🐶' : '🐱';
  return (
    <ModalShell>
      <h2 className="title" style={{ fontSize: 26 }}>
        {title}
      </h2>
      <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
        {targets.map((p) => (
          <button key={p.id} className="secondary" onClick={() => onPick(p.id)}>
            {pawFace} {p.name} ({p.handCount})
          </button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}

/** Name a card to demand from the target (Three of a Kind). */
export function NamedCardPicker({
  onPick,
  onCancel,
}: {
  onPick: (type: CardType) => void;
  onCancel: () => void;
}) {
  const names = cardNames(useTheme());
  // All non-cat, "interesting" cards plus cat cards are nameable.
  const options = (Object.keys(CARD_NAMES) as CardType[]).filter(
    (t) => t !== 'exploding_kitten',
  ) as CardType[];
  return (
    <ModalShell>
      <h2 className="title" style={{ fontSize: 24 }}>
        Name a card to demand
      </h2>
      <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center', margin: '14px 0', gap: 8 }}>
        {options.map((t) => (
          <button key={t} className="secondary" onClick={() => onPick(t)}>
            {names[t]}
          </button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}

/** Pick a card from the discard pile (Five Different Cards combo). */
export function DiscardPicker({
  discardPile,
  onPick,
  onCancel,
}: {
  discardPile: CardModel[];
  onPick: (cardId: string) => void;
  onCancel: () => void;
}) {
  // Unique by type for a cleaner picker; pick the first matching id.
  return (
    <ModalShell>
      <h2 className="title" style={{ fontSize: 24 }}>
        ♻️ Take any card from the discard pile
      </h2>
      <div
        className="row"
        style={{ flexWrap: 'wrap', justifyContent: 'center', margin: '14px 0', gap: 8, maxHeight: 360, overflowY: 'auto' }}
      >
        {discardPile.map((c) => (
          <div key={c.id} onClick={() => onPick(c.id)}>
            <Card type={c.type} selectable small />
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}

export { CAT_CARDS };
