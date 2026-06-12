import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  CARD_NAMES,
  CAT_CARDS,
  type Card as CardModel,
  type CardType,
  type ClientGameView,
} from '@ek/shared';
import { Card } from './Card.js';

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

/** Draw revealed an Exploding Kitten — choose where to secretly reinsert it. */
export function DefusePrompt({
  view,
  defuseCardId,
  onDefuse,
}: {
  view: ClientGameView;
  defuseCardId: string;
  onDefuse: (cardId: string, insertPosition: number) => void;
}) {
  // Positions 0..drawPileCount (0 = top, next to be drawn).
  const max = view.drawPileCount;
  const [pos, setPos] = useState(Math.floor(max / 2));
  return (
    <ModalShell>
      <h2 className="title" style={{ fontSize: 28 }}>
        🙀 Exploding Kitten!
      </h2>
      <p className="muted">
        Play your Defuse and secretly slip the kitten back into the deck. Where should it go?
      </p>
      <div style={{ margin: '20px 0' }}>
        <input
          type="range"
          min={0}
          max={max}
          value={pos}
          style={{ width: '100%' }}
          onChange={(e) => setPos(Number(e.target.value))}
        />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">Top (next draw)</span>
          <span className="badge">
            position {pos} of {max}
          </span>
          <span className="muted">Bottom</span>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <button onClick={() => onDefuse(defuseCardId, 0)}>🔝 On top (evil)</button>
        <button onClick={() => onDefuse(defuseCardId, pos)}>🧯 Defuse here</button>
        <button className="secondary" onClick={() => onDefuse(defuseCardId, max)}>
          Bottom
        </button>
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
  return (
    <ModalShell>
      <h2 className="title" style={{ fontSize: 26 }}>
        {title}
      </h2>
      <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
        {targets.map((p) => (
          <button key={p.id} className="secondary" onClick={() => onPick(p.id)}>
            🐱 {p.name} ({p.handCount})
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
            {CARD_NAMES[t]}
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
