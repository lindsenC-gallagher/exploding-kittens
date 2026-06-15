import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CARD_NAMES, CardType } from '@ek/shared';
import { CARD_VISUALS } from '../data/cardVisuals.js';

// Single-play cards, in a sensible reading order. Cat cards are grouped below.
const SINGLES: CardType[] = [
  CardType.Attack,
  CardType.Skip,
  CardType.SeeTheFuture,
  CardType.Shuffle,
  CardType.Favor,
  CardType.Nope,
  CardType.Defuse,
];

function HelpCard({ type }: { type: CardType }) {
  const v = CARD_VISUALS[type];
  return (
    <div className="help-card">
      <span className="help-emoji">{v.emoji}</span>
      <span className="help-card-name">{CARD_NAMES[type]}</span>
      <span className="help-card-effect">{v.blurb}</span>
    </div>
  );
}

/** Floating "?" button + a terse rules/cards reference. Shown in lobby and game. */
export function HelpButton({ playerCount }: { playerCount: number }) {
  const [open, setOpen] = useState(false);
  const eks = Math.max(0, playerCount - 1);
  return (
    <>
      <button className="help-fab" aria-label="Help & rules" onClick={() => setOpen(true)}>
        ?
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="modal help-modal"
              initial={{ scale: 0.92, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 className="title" style={{ fontSize: 26, margin: 0 }}>
                  How to play 🐱
                </h2>
                <button className="ghost" onClick={() => setOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>

              <ul className="help-rules">
                <li>🎯 Be the last player who hasn&apos;t exploded.</li>
                <li>🔄 Your turn: play any cards, then draw 1 to end it.</li>
                <li>🙀 Draw an Exploding Kitten and you&apos;re out — unless you 🧯 Defuse, then hide it back in the deck.</li>
              </ul>

              <div className="help-counts">
                <span>
                  🙀 Exploding Kittens: <b>{eks}</b> (players − 1)
                </span>
                <span>
                  🧯 Defuses: <b>6</b> (1 each, rest in deck)
                </span>
              </div>

              <h3 className="help-h">Cards</h3>
              <div className="help-grid">
                {SINGLES.map((t) => (
                  <HelpCard key={t} type={t} />
                ))}
                <div className="help-card">
                  <span className="help-emoji">😼</span>
                  <span className="help-card-name">Cat Cards ×5</span>
                  <span className="help-card-effect">No effect alone — combo them.</span>
                </div>
              </div>

              <h3 className="help-h">Combos · play several at once</h3>
              <ul className="help-rules">
                <li>
                  👯 <b>Pair</b> (2 matching) → blind-steal a random card.
                </li>
                <li>
                  🎴 <b>Three matching</b> → name a card; take it if they have it.
                </li>
                <li>
                  🌈 <b>Five different</b> → take any card from the discard.
                </li>
              </ul>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
