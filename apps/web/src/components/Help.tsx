import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CARD_NAMES, CardType, type ClientGameView } from '@ek/shared';
import { cardVisuals } from '../data/cardVisuals.js';
import { useTheme } from '../theme.js';

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
  const v = cardVisuals(useTheme())[type];
  return (
    <div className="help-card">
      <span className="help-emoji">{v.emoji}</span>
      <span className="help-card-name">{CARD_NAMES[type]}</span>
      <span className="help-card-effect">{v.blurb}</span>
    </div>
  );
}

/** Combo rules in display order, keyed to the house-rule flag that gates each. */
const COMBOS: { key: keyof ClientGameView['options']; icon: string; label: string; effect: string }[] = [
  { key: 'allowPairSteal', icon: '👯', label: 'Pair', effect: '(2 matching) → blind-steal a random card.' },
  { key: 'allowTripleDemand', icon: '🎴', label: 'Three matching', effect: '→ name a card; take it if they have it.' },
  { key: 'allowFiveDifferent', icon: '🌈', label: 'Five different', effect: '→ take any card from the discard.' },
];

/** Floating "?" button + a terse rules/cards reference. Shown in lobby and game. */
export function HelpButton({ view }: { view: ClientGameView }) {
  const [open, setOpen] = useState(false);
  const dogs = useTheme() === 'dogs';
  const playerCount = view.players.length;
  const ongoing = view.phase !== 'lobby';
  const eks = Math.max(0, playerCount - 1);
  // Each player is dealt exactly one Defuse; the rest of the 6 stay in the deck.
  const defusesDealt = Math.min(playerCount, 6);
  const defusesInDeck = Math.max(0, 6 - playerCount);
  const options = view.options;
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
                  How to play {dogs ? '🐶' : '🐱'}
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
                {ongoing ? (
                  <>
                    <span>
                      {dogs ? '🐶' : '🙀'} Exploding {dogs ? 'Puppies' : 'Kittens'}: <b>{eks}</b>
                    </span>
                    <span>
                      🧯 Defuses: <b>{defusesDealt}</b> dealt
                      {defusesInDeck > 0 ? (
                        <>
                          , <b>{defusesInDeck}</b> in the deck
                        </>
                      ) : null}
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      {dogs ? '🐶' : '🙀'} Exploding {dogs ? 'Puppies' : 'Kittens'}: <b>{eks}</b> (players − 1)
                    </span>
                    <span>
                      🧯 Defuses: <b>6</b> (1 each, rest in deck)
                    </span>
                  </>
                )}
              </div>

              <h3 className="help-h">Cards</h3>
              <div className="help-grid">
                {SINGLES.map((t) => (
                  <HelpCard key={t} type={t} />
                ))}
                <div className="help-card">
                  <span className="help-emoji">{dogs ? '🐶' : '😼'}</span>
                  <span className="help-card-name">{dogs ? 'Dog' : 'Cat'} Cards ×5</span>
                  <span className="help-card-effect">No effect alone — combo them.</span>
                </div>
              </div>

              <h3 className="help-h">Combos · play several at once</h3>
              <ul className="help-rules">
                {COMBOS.map((c) => {
                  const off = !options[c.key];
                  return (
                    <li key={c.key} className={off ? 'rule-off' : undefined}>
                      {c.icon} <b>{c.label}</b> {c.effect}
                      {off && <span className="rule-off-tag"> — disabled</span>}
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
