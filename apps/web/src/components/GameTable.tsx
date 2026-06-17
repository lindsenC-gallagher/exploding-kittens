import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, Reorder, motion } from 'framer-motion';
import { CardType, type CardType as CT, type ClientMessage } from '@ek/shared';
import type { UseGameSocket } from '../hooks/useGameSocket.js';
import { Card } from './Card.js';
import { Opponents } from './Opponents.js';
import { TurnOrder } from './TurnOrder.js';
import { Piles } from './Piles.js';
import { EventLog } from './EventLog.js';
import { MuteButton } from './MuteButton.js';
import { playSound } from '../lib/sound.js';
import {
  DrawReveal,
  ExplosionFlash,
  FlyingCards,
  NopeStamp,
  PlayedBanner,
  SeeFutureModal,
  StolenToast,
  WinScreen,
  type DrawRevealData,
  type FlyingCard,
  type PlayedBannerData,
  type StolenToastData,
} from './Overlays.js';
import {
  DefusePrompt,
  DiscardPicker,
  FavorPrompt,
  NamedCardPicker,
  StealPickModal,
  TargetPicker,
} from './Prompts.js';

type PlayMode = 'single' | 'pair' | 'triple' | 'five_different' | null;

type Flow =
  | null
  | { step: 'target'; mode: 'favor' | 'pair' | 'triple' }
  | { step: 'name'; target: string }
  | { step: 'discard' };

/** Flying-card visual size (must match `.flying-card` in index.css). */
const FLY_W = 70;
const FLY_H = 98;

export function GameTable({ sock, onLeave }: { sock: UseGameSocket; onLeave: () => void }) {
  const { view, send, lastEvents, seeFuture, clearSeeFuture } = sock;
  const [selected, setSelected] = useState<string[]>([]);
  const [flow, setFlow] = useState<Flow>(null);
  const [showNope, setShowNope] = useState(false);
  const [showBoom, setShowBoom] = useState(false);
  const [nopeLeft, setNopeLeft] = useState(0);
  // A coarse clock that ticks only while a blind steal's grace window is open,
  // so the thief's picker and the victim's "rearrange" countdown stay live.
  const [now, setNow] = useState(() => Date.now());
  const seenEvents = useRef(0);

  const me = view!.players.find((p) => p.id === view!.youId);
  const hand = view?.yourHand ?? [];
  const isMyTurn = view!.currentPlayerId === view!.youId;
  // A blind steal in progress blocks the thief from also drawing/playing.
  const canAct =
    isMyTurn && !view!.nope && !view!.prompt && !view!.stealPick && view!.phase === 'playing';

  // ---- Local hand order (drag-to-arrange, persisted server-side) ------------
  // Hand order is the player's own arrangement and is authoritative server-side
  // (it decides which card a thief grabs on a blind steal). We keep a local
  // order for snappy dragging and reconcile it with the server hand each update.
  const [order, setOrder] = useState<string[]>(() => hand.map((c) => c.id));
  const lastSentOrder = useRef<string[]>(hand.map((c) => c.id));
  const handKey = hand.map((c) => c.id).join(',');
  useEffect(() => {
    const ids = handKey ? handKey.split(',') : [];
    setOrder((prev) => {
      const idSet = new Set(ids);
      const kept = prev.filter((id) => idSet.has(id)); // keep my arrangement
      const keptSet = new Set(kept);
      const added = ids.filter((id) => !keptSet.has(id)); // new cards go to the end
      const next = [...kept, ...added];
      const same = next.length === prev.length && next.every((id, i) => id === prev[i]);
      if (same) return prev;
      // A server-driven change (draw/steal/give) becomes the new baseline so we
      // don't echo it back as a reorder.
      lastSentOrder.current = next;
      return next;
    });
  }, [handKey]);

  const handById = useMemo(() => new Map(hand.map((c) => [c.id, c] as const)), [hand]);
  const orderedCards = useMemo(
    () => order.map((id) => handById.get(id)).filter((c): c is (typeof hand)[number] => !!c),
    [order, handById],
  );

  function persistOrderIfChanged() {
    // Once a blind steal's grace window has closed, the victim's hand is locked;
    // snap any local drag back to the server order rather than sending a reorder
    // the server will reject anyway.
    const sp = view?.stealPick;
    if (sp && sp.from === view?.youId && Date.now() >= sp.pickableAt) {
      setOrder(hand.map((c) => c.id));
      return;
    }
    const cur = order;
    const prev = lastSentOrder.current;
    const same = cur.length === prev.length && cur.every((id, i) => id === prev[i]);
    if (same) return;
    lastSentOrder.current = cur;
    send({ t: 'reorder_hand', order: cur });
  }

  // ---- Transient overlays driven by the event stream ------------------------
  const [playedBanner, setPlayedBanner] = useState<PlayedBannerData | null>(null);
  const [stolenToast, setStolenToast] = useState<StolenToastData | null>(null);
  const [flyingCards, setFlyingCards] = useState<FlyingCard[]>([]);
  // The drawer's private face-up reveal, plus the id of the hand card it lands
  // on (kept hidden until the reveal completes so the card doesn't "flash" in).
  const [drawReveal, setDrawReveal] = useState<DrawRevealData | null>(null);
  const [drawingCardId, setDrawingCardId] = useState<string | null>(null);
  // Guards against a duplicated reveal for the same drawn card (e.g. an effect
  // re-running under React StrictMode in dev), which would otherwise show the
  // card flying in twice.
  const lastRevealRef = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  const overlaySeq = useRef(0);
  const bannerTimer = useRef<ReturnType<typeof setTimeout>>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const drawTimer = useRef<ReturnType<typeof setTimeout>>();

  const nameOf = (id: string) => view!.players.find((p) => p.id === id)?.name ?? 'Someone';

  // The on-screen anchor for a player: your own hand, or their opponent box.
  function playerAnchorId(pid: string): string {
    return pid === view!.youId ? 'hand-anchor' : `opp-anchor-${pid}`;
  }
  function anchorRect(id: string): DOMRect | null {
    if (typeof document === 'undefined') return null;
    return document.getElementById(id)?.getBoundingClientRect() ?? null;
  }
  // Pin the "played" banner to the player who acted: an opponent up top gets the
  // banner below their box (arrow up); your own hand at the bottom gets it above
  // (arrow down). x is clamped so a banner near an edge stays on screen.
  function bannerPosFor(pid: string): PlayedBannerData['pos'] {
    const rect = anchorRect(playerAnchorId(pid));
    if (!rect) return null;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const x = Math.max(150, Math.min(rect.left + rect.width / 2, vw - 150));
    const below = rect.top < (typeof window !== 'undefined' ? window.innerHeight : 768) / 2;
    return { x, y: below ? rect.bottom : rect.top, placement: below ? 'below' : 'above' };
  }
  // Fly a face-down card between two anchors. Used for draws (pile -> drawer) and
  // Favors (giver -> receiver, which everyone sees, face down).
  function flyCard(src: DOMRect | null, dest: DOMRect | null) {
    if (!src || !dest) return;
    const from = { x: src.left + src.width / 2 - FLY_W / 2, y: src.top + src.height / 2 - FLY_H / 2 };
    const to = { x: dest.left + dest.width / 2 - FLY_W / 2, y: dest.top + dest.height / 2 - FLY_H / 2 };
    const id = overlaySeq.current++;
    setFlyingCards((cs) => [...cs, { id, from, to }]);
    setTimeout(() => setFlyingCards((cs) => cs.filter((c) => c.id !== id)), 750);
  }

  // The drawer's POV: reveal the drawn card face up over the pile, then fly it to
  // the exact slot where it lands in the hand. We hide the real hand card until
  // the reveal finishes, so it doesn't pop in mid-flight. The destination is
  // measured from the live DOM (the card is the same size as the pile), so it
  // lands precisely; we poll a few frames in case the hand hasn't rendered yet.
  function revealDraw(card: { id: string; type: CardType }) {
    // De-dupe: ignore a second reveal of the same card within a short window.
    const now = Date.now();
    if (lastRevealRef.current.id === card.id && now - lastRevealRef.current.t < 1500) return;
    lastRevealRef.current = { id: card.id, t: now };
    const src = anchorRect('draw-anchor');
    if (!src) return;
    setDrawingCardId(card.id);
    clearTimeout(drawTimer.current);
    let tries = 0;
    const place = () => {
      const el = document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
      if (el) {
        const dest = el.getBoundingClientRect();
        const id = overlaySeq.current++;
        setDrawReveal({
          id,
          from: { x: src.left, y: src.top },
          to: { x: dest.left, y: dest.top },
          type: card.type,
        });
        drawTimer.current = setTimeout(() => {
          setDrawReveal(null);
          setDrawingCardId(null);
        }, 880);
        return;
      }
      if (tries++ < 40) requestAnimationFrame(place);
      else setDrawingCardId(null); // hand never rendered the card; just show it
    };
    requestAnimationFrame(place);
  }

  useEffect(() => {
    if (!lastEvents || lastEvents.id === seenEvents.current) return;
    seenEvents.current = lastEvents.id;
    for (const e of lastEvents.events) {
      if (e.type === 'nope') {
        setShowNope(true);
        playSound('nope');
        setTimeout(() => setShowNope(false), 1100);
      } else if (e.type === 'exploded') {
        setShowBoom(true);
        playSound('explode');
        setTimeout(() => setShowBoom(false), 1300);
      } else if (e.type === 'cards_played') {
        setPlayedBanner({
          id: overlaySeq.current++,
          byName: nameOf(e.by),
          targetName: e.target ? nameOf(e.target) : undefined,
          cards: e.cards,
          combo: e.combo,
          pos: bannerPosFor(e.by),
        });
        playSound('play');
        clearTimeout(bannerTimer.current);
        bannerTimer.current = setTimeout(() => setPlayedBanner(null), 2800);
      } else if (e.type === 'shuffled') {
        playSound('shuffle');
      } else if (e.type === 'defused') {
        playSound('defuse');
      } else if (e.type === 'game_over') {
        playSound('win');
      } else if (e.type === 'turn_changed') {
        // A gentle chime only when it becomes *your* turn, so it isn't spammy.
        if (e.playerId === view!.youId) playSound('turn');
      } else if (e.type === 'card_drawn') {
        playSound('draw');
        if (e.by === view!.youId && e.card) {
          // Your own draw: reveal the real card face up, flying into your hand.
          revealDraw(e.card);
        } else {
          // Someone else drew (or your Exploding Kitten draw): face-down fly.
          flyCard(anchorRect('draw-anchor'), anchorRect(playerAnchorId(e.by)));
        }
      } else if (e.type === 'card_given') {
        // Favor: a face-down card travels from the giver to the receiver. Public,
        // so every player sees the hand-off (face down — the card stays hidden).
        flyCard(anchorRect(playerAnchorId(e.from)), anchorRect(playerAnchorId(e.to)));
      } else if (e.type === 'stole' && e.card) {
        playSound('steal');
        // Only the thief and victim receive the card (others get it redacted).
        const mine = e.by === view!.youId;
        setStolenToast({
          id: overlaySeq.current++,
          mine,
          otherName: nameOf(mine ? e.from : e.by),
          card: e.card,
        });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setStolenToast(null), 3600);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvents, view]);

  useEffect(
    () => () => {
      clearTimeout(bannerTimer.current);
      clearTimeout(toastTimer.current);
      clearTimeout(drawTimer.current);
    },
    [],
  );

  // The See-the-Future reveal arrives as its own message (private to the viewer),
  // so chime when that modal opens rather than from the public event stream.
  useEffect(() => {
    if (seeFuture) playSound('future');
  }, [seeFuture]);

  // Clear any in-progress selection/flow whenever you can no longer act
  // (turn passed, a prompt opened, or a Nope window started).
  useEffect(() => {
    if (!canAct) {
      setSelected([]);
      setFlow(null);
    }
  }, [canAct]);

  // Nope window countdown. Keyed on the deadline (a primitive) so it only
  // resets when the deadline actually changes.
  const nopeDeadline = view?.nope?.deadline ?? null;
  useEffect(() => {
    if (!nopeDeadline) {
      setNopeLeft(0);
      return;
    }
    const tick = () => setNopeLeft(Math.max(0, nopeDeadline - Date.now()));
    tick();
    const h = setInterval(tick, 100);
    return () => clearInterval(h);
  }, [nopeDeadline]);

  // While a blind steal is open, keep a live clock so the victim's "rearrange"
  // countdown and the thief's locked picker update without a server round-trip.
  const stealPickableAt = view?.stealPick?.pickableAt ?? null;
  useEffect(() => {
    if (stealPickableAt === null) return;
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(h);
  }, [stealPickableAt]);

  // Analyse the current hand selection into a play mode.
  const selectedCards = useMemo(() => hand.filter((c) => selected.includes(c.id)), [hand, selected]);
  const options = view!.options;
  const playMode: PlayMode = useMemo(() => {
    const types = selectedCards.map((c) => c.type);
    const unique = new Set(types);
    if (types.length === 1) {
      const t = types[0];
      if ([CardType.Defuse, CardType.Nope, CardType.ExplodingKitten].includes(t)) return null;
      if (isCat(t)) return null; // single cat card has no effect
      return 'single';
    }
    // Combos the host disabled aren't offered (the engine also rejects them).
    if (types.length === 2 && unique.size === 1) return options.allowPairSteal ? 'pair' : null;
    if (types.length === 3 && unique.size === 1) return options.allowTripleDemand ? 'triple' : null;
    if (types.length === 5 && unique.size === 5)
      return options.allowFiveDifferent ? 'five_different' : null;
    return null;
  }, [selectedCards, options]);

  if (!view || !me) return null;

  function toggle(id: string) {
    if (!canAct) return;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  // Send a play and immediately clear local selection/flow (optimistic). We do
  // NOT wait for an incoming event to clear, so unrelated broadcasts can't wipe
  // an in-progress selection.
  function doPlay(msg: ClientMessage) {
    send(msg);
    setSelected([]);
    setFlow(null);
  }

  function play() {
    if (!playMode) return;
    if (playMode === 'single') {
      const t = selectedCards[0].type;
      if (t === CardType.Favor) return setFlow({ step: 'target', mode: 'favor' });
      doPlay({ t: 'play', cardIds: selected });
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
      doPlay({ t: 'play', cardIds: selected, target });
    } else if (f.mode === 'pair') {
      doPlay({ t: 'play', cardIds: selected, combo: 'pair', target });
    } else {
      setFlow({ step: 'name', target });
    }
  }

  const nopeCardId = hand.find((c) => c.type === CardType.Nope)?.id;
  const defuseCardId = hand.find((c) => c.type === CardType.Defuse)?.id;
  const favorPrompt = view.prompt?.type === 'favor_give' ? view.prompt : null;
  const stealPick = view.stealPick;
  const iAmThief = !!stealPick && stealPick.by === view.youId;
  const iAmVictim = !!stealPick && stealPick.from === view.youId;
  // The victim's grace window: they may rearrange until `pickableAt`; after that
  // their hand is locked in and the thief is free to pick.
  const stealShuffleLeft = stealPick ? Math.max(0, stealPick.pickableAt - now) : 0;
  const victimLocked = iAmVictim && stealShuffleLeft <= 0;
  const playLabel = describePlay(playMode, selectedCards.length);
  // You may Nope unless it's your own action that's currently set to resolve.
  // (You can still "Yup" — play a Nope when the count is odd — to counter a Nope.)
  const canNope =
    !!view.nope && !!nopeCardId && (view.nope.by !== view.youId || view.nope.nopes % 2 === 1);

  return (
    <div className="table">
      <MuteButton />
      <TurnOrder view={view} />
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
          {canAct && selected.length > 0 && !playMode && (
            <span className="badge" style={{ alignSelf: 'center' }}>
              Pick 1 action card, a matching pair/triple, or 5 different cards
            </span>
          )}
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

        {iAmVictim && (
          <motion.div
            className="steal-hint"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {victimLocked ? (
              <>🔒 {nameOf(stealPick!.by)} is now picking — your hand is locked in!</>
            ) : (
              <>
                {view!.options.theme === 'dogs' ? '🐶' : '😼'} {nameOf(stealPick!.by)} is about to
                blind-steal — rearrange your cards now!{' '}
                <b>{Math.ceil(stealShuffleLeft / 1000)}s</b> until your hand locks.
              </>
            )}
          </motion.div>
        )}

        <Reorder.Group
          as="div"
          axis="x"
          className={`hand fan ${victimLocked ? 'locked' : ''}`}
          id="hand-anchor"
          values={order}
          onReorder={victimLocked ? () => {} : setOrder}
          onPointerUp={persistOrderIfChanged}
        >
          <AnimatePresence>
            {orderedCards.map((c, i) => {
              const fan = fanTransform(i, orderedCards.length);
              return (
                <Reorder.Item
                  key={c.id}
                  value={c.id}
                  as="div"
                  className="hand-item"
                  data-card-id={c.id}
                  // Disable drag only while the victim's hand is locked. Passing
                  // `drag` at all (even undefined) overrides Reorder.Item's
                  // internal axis drag, so omit it entirely otherwise.
                  {...(victimLocked ? { drag: false as const } : {})}
                  // Selected cards sit above their neighbours so the lift reads
                  // clearly; hovering raises a card so overlapped cards in the
                  // fan are always clickable.
                  style={{ zIndex: selected.includes(c.id) ? 30 : i }}
                  whileHover={{ zIndex: 31 }}
                  initial={{ opacity: 0, y: 60, scale: 0.6 }}
                  // While its face-up draw reveal is in flight, the slot stays
                  // invisible (but holds layout, so the reveal lands on it); once
                  // the reveal clears, the card springs into view.
                  animate={
                    drawingCardId === c.id
                      ? { opacity: 0, y: 0, scale: 1 }
                      : { opacity: 1, y: 0, scale: 1 }
                  }
                  exit={{ opacity: 0, y: -80, scale: 0.5 }}
                  transition={{ type: 'spring', stiffness: 350, damping: 26 }}
                  whileDrag={{ scale: 1.07, zIndex: 40 }}
                  onDragEnd={persistOrderIfChanged}
                >
                  {/* Static fan tilt lives on this wrapper so it composes with
                      framer's drag/reorder transforms on the item above. */}
                  <div
                    className="fan-card"
                    style={{ transform: `translateY(${fan.y}px) rotate(${fan.rot}deg)` }}
                  >
                    <Card
                      type={c.type}
                      selectable={canAct}
                      selected={selected.includes(c.id)}
                      onClick={() => toggle(c.id)}
                    />
                  </div>
                </Reorder.Item>
              );
            })}
          </AnimatePresence>
        </Reorder.Group>
        <div className="hand-hint muted">🤚 Held like a fan · drag to rearrange your hand</div>
      </div>

      {/* Floating Nope button during a Nope window. */}
      <AnimatePresence>
        {canNope && (
          <motion.div
            // x:'-50%' centers via framer's transform so it survives the scale
            // animation (a CSS translateX would be clobbered).
            initial={{ scale: 0, y: 40, x: '-50%' }}
            animate={{ scale: 1, y: 0, x: '-50%' }}
            exit={{ scale: 0, x: '-50%' }}
            style={{
              position: 'fixed',
              bottom: 24,
              left: '50%',
              zIndex: 40,
            }}
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
      {iAmThief && (
        <StealPickModal
          fromName={nameOf(stealPick!.from)}
          count={view.players.find((p) => p.id === stealPick!.from)?.handCount ?? 0}
          msUntilPickable={stealShuffleLeft}
          onPick={(cardIndex) => send({ t: 'steal_pick', cardIndex })}
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
          onPick={(type) =>
            doPlay({ t: 'play', cardIds: selected, combo: 'triple', target: flow.target, namedCard: type })
          }
          onCancel={() => setFlow(null)}
        />
      )}
      {flow?.step === 'discard' && (
        <DiscardPicker
          discardPile={view.discardPile}
          onPick={(cardId) =>
            doPlay({ t: 'play', cardIds: selected, combo: 'five_different', discardCardId: cardId })
          }
          onCancel={() => setFlow(null)}
        />
      )}

      <PlayedBanner banner={playedBanner} />
      <StolenToast toast={stolenToast} />
      <FlyingCards cards={flyingCards} />
      <DrawReveal reveal={drawReveal} />
      <NopeStamp show={showNope} />
      <ExplosionFlash show={showBoom} />
      <SeeFutureModal cards={seeFuture} onClose={clearSeeFuture} />
      <WinScreen view={view} onLeave={onLeave} />
      <EventLog view={view} lastEvents={lastEvents} />
    </div>
  );
}

/**
 * Fan tilt + vertical drop for the i-th of n hand cards, so the hand arcs like
 * cards held in a hand: the middle card sits highest and upright, the edges
 * rotate outward and dip down. Returns degrees and px offsets for a wrapper
 * transform (kept off the draggable item so it composes with framer's drag).
 */
function fanTransform(i: number, n: number): { rot: number; y: number } {
  if (n <= 1) return { rot: 0, y: 0 };
  const mid = (n - 1) / 2;
  const rel = i - mid;
  const perCard = Math.min(7, 46 / n); // tighter fan as the hand grows
  const rot = rel * perCard;
  const y = Math.pow(Math.abs(rel), 1.3) * 7;
  return { rot, y };
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
