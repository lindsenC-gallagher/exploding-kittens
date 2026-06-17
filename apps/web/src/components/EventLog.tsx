import { useEffect, useRef, useState } from 'react';
import { cardNames, type ClientGameView, type GameEvent } from '@ek/shared';
import type { GameEventEnvelope } from '../hooks/useGameSocket.js';
import { cardVisuals } from '../data/cardVisuals.js';
import type { CardType } from '@ek/shared';

function nameOf(view: ClientGameView, id: string): string {
  if (id === view.youId) return 'You';
  return view.players.find((p) => p.id === id)?.name ?? 'Someone';
}

/** "🃏 Skip" — leading emoji + card name, for inline mentions in the log. */
function cardLabel(view: ClientGameView, type: CardType): string {
  return `${cardVisuals(view.options.theme)[type].emoji.slice(0, 2)} ${cardNames(view.options.theme)[type]}`;
}

function describe(view: ClientGameView, e: GameEvent): string | null {
  switch (e.type) {
    case 'game_started':
      return '🎬 Game started!';
    case 'cards_played':
      return `🃏 ${nameOf(view, e.by)} played ${e.cards.map((c) => cardNames(view.options.theme)[c.type]).join(' + ')}`;
    case 'nope':
      return `🚫 Nope! (${e.nopes})`;
    case 'action_resolved':
      return e.cancelled ? '…the action was Noped.' : null;
    case 'card_drawn':
      return `🤚 ${nameOf(view, e.by)} drew a card`;
    case 'shuffled':
      return '🔀 The deck was shuffled';
    case 'favor_requested':
      return `🎁 ${nameOf(view, e.to)} asked ${nameOf(view, e.from)} for a favor`;
    case 'card_given':
      return `📤 ${nameOf(view, e.from)} gave a card to ${nameOf(view, e.to)}`;
    case 'stole': {
      // The card is present only for the thief and the victim (redacted server
      // side for everyone else), so only they ever see *which* card moved.
      const thief = nameOf(view, e.by);
      const victim = nameOf(view, e.from);
      if (e.card) {
        if (e.by === view.youId) return `🦝 You stole ${cardLabel(view, e.card.type)} from ${victim}`;
        if (e.from === view.youId)
          return `${view.options.theme === 'dogs' ? '😢' : '😿'} ${thief} stole your ${cardLabel(view, e.card.type)}`;
        return `🦝 ${thief} stole ${cardLabel(view, e.card.type)} from ${victim}`;
      }
      return `🦝 ${thief} stole a card from ${victim}`;
    }
    case 'took_from_discard':
      return `♻️ ${nameOf(view, e.by)} took ${cardLabel(view, e.card.type)} from the discard`;
    case 'exploded':
      return `💥 ${nameOf(view, e.playerId)} EXPLODED!`;
    case 'defused':
      return `🧯 ${nameOf(view, e.playerId)} defused the ${view.options.theme === 'dogs' ? 'puppy' : 'kitten'}!`;
    case 'turn_changed':
      return null;
    case 'game_over':
      return `🏆 ${nameOf(view, e.winnerId)} wins!`;
    default:
      return null;
  }
}

interface LogLine {
  id: number;
  text: string;
}

type LogSize = 'min' | 'normal' | 'max';

const SIZE_KEY = 'ek_log_size';

function readSize(): LogSize {
  try {
    const s = localStorage.getItem(SIZE_KEY);
    if (s === 'min' || s === 'normal' || s === 'max') return s;
  } catch {
    /* ignore */
  }
  // On phones/tablets the log floats over the bottom hand, so start it collapsed
  // — the player can expand it deliberately. (Desktop keeps the roomy default.)
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches) {
      return 'min';
    }
  } catch {
    /* ignore */
  }
  return 'normal';
}

export function EventLog({ view, lastEvents }: { view: ClientGameView; lastEvents: GameEventEnvelope | null }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [size, setSize] = useState<LogSize>(readSize);
  const seen = useRef(0);
  const nextId = useRef(0);
  const ref = useRef<HTMLDivElement>(null);

  function changeSize(next: LogSize) {
    setSize(next);
    try {
      localStorage.setItem(SIZE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!lastEvents || lastEvents.id === seen.current) return;
    seen.current = lastEvents.id;
    const newLines = lastEvents.events
      .map((e) => describe(view, e))
      .filter((x): x is string => !!x)
      .map((text) => ({ id: nextId.current++, text }));
    if (newLines.length) setLines((prev) => [...prev, ...newLines].slice(-200));
  }, [lastEvents, view]);

  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [lines, size]);

  return (
    <div className={`log ${size}`}>
      <div className="log-title">
        <span>📜 Game log</span>
        <span className="log-controls">
          {size !== 'min' && (
            <button
              className="log-btn"
              aria-label="Minimize log"
              title="Minimize"
              onClick={() => changeSize('min')}
            >
              —
            </button>
          )}
          {size !== 'max' && (
            <button
              className="log-btn"
              aria-label="Maximize log"
              title="Maximize"
              onClick={() => changeSize('max')}
            >
              ▢
            </button>
          )}
          {size === 'max' && (
            <button
              className="log-btn"
              aria-label="Restore log"
              title="Restore"
              onClick={() => changeSize('normal')}
            >
              ❐
            </button>
          )}
          {size === 'min' && (
            <button
              className="log-btn"
              aria-label="Expand log"
              title="Expand"
              onClick={() => changeSize('normal')}
            >
              ▢
            </button>
          )}
        </span>
      </div>
      {size !== 'min' && (
        <div className="log-body" ref={ref}>
          {lines.length === 0 && <p className="muted">Nothing yet — make a move!</p>}
          {lines.map((l) => (
            <p key={l.id}>{l.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}
