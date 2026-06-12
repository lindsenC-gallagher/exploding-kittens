import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CardType, type CardType as CT } from '@ek/shared';
import type { UseGameSocket } from '../hooks/useGameSocket.js';
import { Card } from './Card.js';
import { Opponents } from './Opponents.js';
import { Piles } from './Piles.js';
import { EventLog } from './EventLog.js';
import { ExplosionFlash, NopeStamp, SeeFutureModal, WinScreen } from './Overlays.js';
import {
  DefusePrompt,
  DiscardPicker,
  FavorPrompt,
  NamedCardPicker,
  TargetPicker,
} from './Prompts.js';

type PlayMode = 'single' | 'pair' | 'triple' | 'five_different' | null;

type Flow =
  | null
  | { step: 'target'; mode: 'favor' | 'pair' | 'triple' }
  | { step: 'name'; target: string }
  | { step: 'discard' };

export function GameTable({ sock, onLeave }: { sock: UseGameSocket; onLeave: () => void }) {
  const { view, send, lastEvents, seeFuture, clearSeeFuture } = sock;
  const [selected, setSelected] = useState<string[]>([]);
  const [flow, setFlow] = useState<Flow>(null);
  const [showNope, setShowNope] = useState(false);
  const [showBoom, setShowBoom] = useState(false);
  const [nopeLeft, setNopeLeft] = useState(0);
  const seenEvents = useRef(0);

  const me = view!.players.find((p) => p.id === view!.youId);
  const hand = view?.yourHand ?? [];
  const isMyTurn = view!.currentPlayerId === view!.youId;
  const canAct = isMyTurn && !view!.nope && !view!.prompt && view!.phase === 'playing';

  // Analyse the current hand selection into a play mode.
  const selectedCards = useMemo(
    () => hand.filter((c) => selected.includes(c.id)),
    [hand, selected],
  );
  const playMode: PlayMode = useMemo(() => {
    const types = selectedCards.map((c) => c.type);
    const unique = new Set(types);
    if (types.length === 1) {
      const t = types[0];
      if ([CardType.Defuse, CardType.Nope, CardType.ExplodingKitten].includes(t)) return null;
      if (isCat(t)) return null; // single cat card has no effect
      return 'single';
    }
    if (types.length === 2 && unique.size === 1) return 'pair';
    if (types.length === 3 && unique.size === 1) return 'triple';
    if (types.length === 5 && unique.size === 5) return 'five_different';
    return null;
  }, [selectedCards]);

  // Transient animation triggers from the event stream.
  useEffect(() => {
    if (!lastEvents || lastEvents.id === seenEvents.current) return;
    seenEvents.current = lastEvents.id;
    if (lastEvents.events.some((e) => e.type === 'nope')) {
      setShowNope(true);
      setTimeout(() => setShowNope(false), 1100);
    }
    if (lastEvents.events.some((e) => e.type === 'exploded')) {
      setShowBoom(true);
      setTimeout(() => setShowBoom(false), 1300);
    }
    // Selection may have been consumed by a play.
    setSelected([]);
    setFlow(null);
  }, [lastEvents]);

  // Nope window countdown.
  useEffect(() => {
    if (!view!.nope) {
      setNopeLeft(0);
      return;
    }
    const tick = () => setNopeLeft(Math.max(0, view!.nope!.deadline - Date.now()));
    tick();
    const h = setInterval(tick, 100);
    return () => clearInterval(h);
  }, [view!.nope]);

  if (!view || !me) return null;

  function toggle(id: string) {
    if (!canAct) return;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function play() {
    if (!playMode) return;
    if (playMode === 'single') {
      const t = selectedCards[0].type;
      if (t === CardType.Favor) return setFlow({ step: 'target', mode: 'favor' });
      send({ t: 'play', cardIds: selected });
      return;
    }
    if (playMode === 'pair') return setFlow({ step: 'target', mode: 'pair' });
    if (playMode === 'triple') return setFlow({ step: 'target', mode: 'triple' });
    if (playMode === 'five_different') return setFlow({ step: 'discard' });
  }

  function onTargetPicked(target: string) {
    const f = flow;
    if (!f || f.step !== 'target') return;
    if (f.mode === 'favor') {
      send({ t: 'play', cardIds: selected, target });
      setFlow(null);
    } else if (f.mode === 'pair') {
      send({ t: 'play', cardIds: selected, combo: 'pair', target });
      setFlow(null);
    } else {
      setFlow({ step: 'name', target });
    }
  }

  const nopeCardId = hand.find((c) => c.type === CardType.Nope)?.id;
  const defuseCardId = hand.find((c) => c.type === CardType.Defuse)?.id;
  const favorPrompt = view.prompt?.type === 'favor_give' ? view.prompt : null;
  const playLabel = describePlay(playMode, selectedCards.length);

  return (
    <div className="table">
      <Opponents view={view} />

      <div className="stack" style={{ justifyContent: 'center' }}>
        <div className={`turn-banner ${isMyTurn ? 'you' : ''}`}>
          {view.phase === 'playing' &&
            (isMyTurn
              ? `🎯 Your turn${view.turnsRemaining > 1 ? ` — ${view.turnsRemaining} turns!` : ''}`
              : `⏳ ${view.players.find((p) => p.id === view.currentPlayerId)?.name ?? '...'}'s turn`)}
        </div>
        <Piles view={view} canDraw={canAct} onDraw={() => send({ t: 'draw' })} />
      </div>

      {/* Hand + action bar */}
      <div className="stack">
        <div className="toolbar">
          {playMode && canAct && <button onClick={play}>▶ Play {playLabel}</button>}
          {selected.length > 0 && (
            <button className="ghost" onClick={() => setSelected([])}>
              Clear
            </button>
          )}
          {canAct && (
            <button className="secondary" onClick={() => send({ t: 'draw' })}>
              🤚 Draw &amp; end turn
            </button>
          )}
        </div>

        <div className="hand">
          <AnimatePresence>
            {hand.map((c) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 60, scale: 0.6 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -80, scale: 0.5 }}
                transition={{ type: 'spring', stiffness: 350, damping: 26 }}
              >
                <Card
                  type={c.type}
                  selectable={canAct}
                  selected={selected.includes(c.id)}
                  onClick={() => toggle(c.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Floating Nope button during a Nope window. */}
      <AnimatePresence>
        {view.nope && nopeCardId && (
          <motion.div
            initial={{ scale: 0, y: 40 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0 }}
            style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 40 }}
          >
            <button
              style={{ fontSize: 22, padding: '14px 26px' }}
              onClick={() => send({ t: 'nope', cardId: nopeCardId })}
            >
              🚫 NOPE! ({Math.ceil(nopeLeft / 1000)}s)
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Prompts */}
      {view.prompt?.type === 'defuse_or_explode' && defuseCardId && (
        <DefusePrompt
          view={view}
          defuseCardId={defuseCardId}
          onDefuse={(cardId, insertPosition) => send({ t: 'defuse', cardId, insertPosition })}
        />
      )}
      {favorPrompt && (
        <FavorPrompt
          hand={hand}
          toName={view.players.find((p) => p.id === favorPrompt.toPlayerId)?.name ?? 'Someone'}
          onGive={(cardId) => send({ t: 'give_favor_card', cardId })}
        />
      )}

      {flow?.step === 'target' && (
        <TargetPicker
          view={view}
          title={flow.mode === 'favor' ? '🎁 Favor — pick a player' : '🦝 Steal from…'}
          onPick={onTargetPicked}
          onCancel={() => setFlow(null)}
        />
      )}
      {flow?.step === 'name' && (
        <NamedCardPicker
          onPick={(type) => {
            send({ t: 'play', cardIds: selected, combo: 'triple', target: flow.target, namedCard: type });
            setFlow(null);
          }}
          onCancel={() => setFlow(null)}
        />
      )}
      {flow?.step === 'discard' && (
        <DiscardPicker
          discardPile={view.discardPile}
          onPick={(cardId) => {
            send({ t: 'play', cardIds: selected, combo: 'five_different', discardCardId: cardId });
            setFlow(null);
          }}
          onCancel={() => setFlow(null)}
        />
      )}

      <NopeStamp show={showNope} />
      <ExplosionFlash show={showBoom} />
      <SeeFutureModal cards={seeFuture} onClose={clearSeeFuture} />
      <WinScreen view={view} onLeave={onLeave} />
      <EventLog view={view} lastEvents={lastEvents} />
    </div>
  );
}

function isCat(t: CT): boolean {
  return [
    CardType.Tacocat,
    CardType.Cattermelon,
    CardType.HairyPotatoCat,
    CardType.BeardCat,
    CardType.RainbowRalphingCat,
  ].includes(t);
}

function describePlay(mode: PlayMode, count: number): string {
  switch (mode) {
    case 'single':
      return 'card';
    case 'pair':
      return 'pair (steal)';
    case 'triple':
      return 'triple (demand)';
    case 'five_different':
      return '5 different (take from discard)';
    default:
      return `${count} cards`;
  }
}
