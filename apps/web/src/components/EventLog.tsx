import { useEffect, useRef, useState } from 'react';
import { CARD_NAMES, type ClientGameView, type GameEvent } from '@ek/shared';
import type { GameEventEnvelope } from '../hooks/useGameSocket.js';

function nameOf(view: ClientGameView, id: string): string {
  return view.players.find((p) => p.id === id)?.name ?? 'Someone';
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
    case 'stole':
      return `🦝 ${nameOf(view, e.by)} stole from ${nameOf(view, e.from)}`;
    case 'took_from_discard':
      return `♻️ ${nameOf(view, e.by)} took ${CARD_NAMES[e.card.type]} from the discard`;
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
    if (newLines.length) setLines((prev) => [...prev, ...newLines].slice(-50));
  }, [lastEvents, view]);

  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [lines]);

  return (
    <div className="log" ref={ref}>
      {lines.length === 0 && <p>Game log…</p>}
      {lines.map((l) => (
        <p key={l.id}>{l.text}</p>
      ))}
    </div>
  );
}
