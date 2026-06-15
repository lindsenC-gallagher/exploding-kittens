import { useEffect, useRef, useState } from 'react';
import { CARD_NAMES, type ClientGameView, type GameEvent } from '@ek/shared';
import type { GameEventEnvelope } from '../hooks/useGameSocket.js';
import { CARD_VISUALS } from '../data/cardVisuals.js';
import type { CardType } from '@ek/shared';

function nameOf(view: ClientGameView, id: string): string {
  if (id === view.youId) return 'You';
  return view.players.find((p) => p.id === id)?.name ?? 'Someone';
}

/** "🃏 Skip" — leading emoji + card name, for inline mentions in the log. */
function cardLabel(type: CardType): string {
  return `${CARD_VISUALS[type].emoji.slice(0, 2)} ${CARD_NAMES[type]}`;
}

function describe(view: ClientGameView, e: GameEvent): string | null {
  switch (e.type) {
    case 'game_started':
      return '🎬 Game started!';
    case 'cards_played':
      return `🃏 ${nameOf(view, e.by)} played ${e.cards.map((c) => CARD_NAMES[c.type]).join(' + ')}`;
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
        if (e.by === view.youId) return `🦝 You stole ${cardLabel(e.card.type)} from ${victim}`;
        if (e.from === view.youId) return `😿 ${thief} stole your ${cardLabel(e.card.type)}`;
        return `🦝 ${thief} stole ${cardLabel(e.card.type)} from ${victim}`;
      }
      return `🦝 ${thief} stole a card from ${victim}`;
    }
    case 'took_from_discard':
      return `♻️ ${nameOf(view, e.by)} took ${cardLabel(e.card.type)} from the discard`;
    case 'exploded':
      return `💥 ${nameOf(view, e.playerId)} EXPLODED!`;
    case 'defused':
      return `🧯 ${nameOf(view, e.playerId)} defused the kitten!`;
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

export function EventLog({ view, lastEvents }: { view: ClientGameView; lastEvents: GameEventEnvelope | null }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const seen = useRef(0);
  const nextId = useRef(0);
  const ref = useRef<HTMLDivElement>(null);

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
  }, [lines]);

  return (
    <div className="log">
      <div className="log-title">📜 Game log</div>
      <div className="log-body" ref={ref}>
        {lines.length === 0 && <p className="muted">Nothing yet — make a move!</p>}
        {lines.map((l) => (
          <p key={l.id}>{l.text}</p>
        ))}
      </div>
    </div>
  );
}
