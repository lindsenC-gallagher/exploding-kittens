import { describe, expect, it } from 'vitest';
import { CardType } from './cards.js';
import { addBot, addPlayer, applyAction, createLobby, removeBot, startGame, type GameAction } from './engine.js';
import { decideBotMove, type Rand } from './bot.js';
import type { ClientMessage } from './protocol.js';
import type { BotDifficulty, GameState } from './state.js';
import { projectView } from './view.js';

/** Deterministic [0,1) RNG so bot play is reproducible in tests. */
function makeRand(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A lobby seeded with `humans` human seats then `bots` bot seats of `difficulty`. */
function lobbyWithBots(humans: number, bots: number, difficulty: BotDifficulty): GameState {
  let state = createLobby('p0');
  for (let i = 0; i < humans; i++) {
    const r = addPlayer(state, `p${i}`, `Player ${i}`);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  for (let i = 0; i < bots; i++) {
    const r = addBot(state, `bot${i}`, difficulty);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  return state;
}

function msgToAction(pid: string, msg: ClientMessage): GameAction {
  switch (msg.t) {
    case 'play':
      return {
        type: 'play',
        playerId: pid,
        cardIds: msg.cardIds,
        combo: msg.combo,
        target: msg.target,
        namedCard: msg.namedCard,
        discardCardId: msg.discardCardId,
      };
    case 'nope':
      return { type: 'nope', playerId: pid, cardId: msg.cardId };
    case 'draw':
      return { type: 'draw', playerId: pid };
    case 'defuse':
      return { type: 'defuse', playerId: pid, cardId: msg.cardId, insertPosition: msg.insertPosition };
    case 'give_favor_card':
      return { type: 'give_favor_card', playerId: pid, cardId: msg.cardId };
    case 'steal_pick':
      return { type: 'steal_pick', playerId: pid, cardIndex: msg.cardIndex };
    default:
      throw new Error(`bot produced an unexpected message: ${msg.t}`);
  }
}

function apply(state: GameState, action: GameAction): GameState {
  const r = applyAction(state, action, { rngSeed: 7 });
  if (!r.ok) throw new Error(`engine REJECTED a bot move (${action.type}): ${r.error}`);
  return r.state;
}

/**
 * Run an all-bot game to completion by driving each seat through exactly the
 * pipeline the server uses: project the player's REDACTED view, ask the bot for
 * a move, feed it back through applyAction. Any illegal move makes `apply` throw,
 * so a clean run proves the bot only ever emits legal actions from public info.
 */
function playOut(initial: GameState, fallback: BotDifficulty, rand: Rand, maxSteps = 4000): GameState {
  let state = initial;
  let steps = 0;
  while (state.phase === 'playing' && steps++ < maxSteps) {
    if (state.pending) {
      // Let any seat that wants to throw a Nope do so; otherwise resolve the window.
      let noped = false;
      for (const p of state.players) {
        if (!p.alive) continue;
        const view = projectView(state, 'ROOM', p.id, Date.now() + 5000, 0);
        const m = decideBotMove(view, p.botDifficulty ?? fallback, rand);
        if (m && m.t === 'nope') {
          state = apply(state, msgToAction(p.id, m));
          noped = true;
          break;
        }
      }
      if (!noped) state = apply(state, { type: 'resolve_pending' });
      continue;
    }
    const actorId = state.awaiting ? state.awaiting.playerId : state.players[state.currentPlayerIndex].id;
    const actor = state.players.find((p) => p.id === actorId)!;
    const view = projectView(state, 'ROOM', actorId, null, 0);
    const m = decideBotMove(view, actor.botDifficulty ?? fallback, rand);
    if (!m) {
      if (state.awaiting) throw new Error(`bot returned no move while awaiting ${state.awaiting.type}`);
      state = apply(state, { type: 'draw', playerId: actorId });
      continue;
    }
    state = apply(state, msgToAction(actorId, m));
  }
  return state;
}

describe('addBot / removeBot', () => {
  it('seats a bot with a robot avatar and the chosen difficulty', () => {
    const r = addBot(createLobby('p0'), 'bot0', 'hard');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bot = r.state.players[0];
    expect(bot.isBot).toBe(true);
    expect(bot.botDifficulty).toBe('hard');
    expect(bot.ready).toBe(true);
    expect(bot.avatar).toBe('🤖');
  });

  it('refuses to add a bot once the lobby is full or the game has started', () => {
    let state = lobbyWithBots(0, 9, 'easy'); // maxPlayers = 9
    expect(addBot(state, 'extra', 'easy').ok).toBe(false);
    const started = startGame(lobbyWithBots(2, 0, 'easy'), 1);
    if (started.ok) expect(addBot(started.state, 'late', 'easy').ok).toBe(false);
  });

  it('removeBot drops only bots, only in the lobby', () => {
    const state = lobbyWithBots(1, 1, 'easy');
    const botId = state.players.find((p) => p.isBot)!.id;
    expect(removeBot(state, botId).players).toHaveLength(1);
    // Removing a human id is a no-op.
    expect(removeBot(state, 'p0').players).toHaveLength(2);
  });
});

describe('decideBotMove fairness + correctness', () => {
  it('returns null when it is not the bot\'s turn and nothing is aimed at it', () => {
    const started = startGame(lobbyWithBots(2, 0, 'easy'), 1);
    if (!started.ok) throw new Error(started.error);
    const state = started.state;
    const notCurrent = state.players[(state.currentPlayerIndex + 1) % state.players.length];
    const view = projectView(state, 'ROOM', notCurrent.id, null, 0);
    expect(decideBotMove(view, 'hard', makeRand(1))).toBeNull();
  });

  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    for (const n of [2, 3, 5]) {
      it(`plays a clean ${n}-bot ${difficulty} game to a single winner`, () => {
        const started = startGame(lobbyWithBots(0, n, difficulty), 100 + n);
        if (!started.ok) throw new Error(started.error);
        const final = playOut(started.state, difficulty, makeRand(42 + n));
        expect(final.phase).toBe('gameOver');
        expect(final.winnerId).toBeTruthy();
        expect(final.players.filter((p) => p.alive)).toHaveLength(1);
      });
    }
  }

  it('a hard bot buries the kitten when it still owes turns, else drops it on top', () => {
    // Construct an awaiting defuse_or_explode for a hard bot, with a draw pile.
    const base = startGame(lobbyWithBots(0, 2, 'hard'), 5);
    if (!base.ok) throw new Error(base.error);
    const cur = base.state.players[base.state.currentPlayerIndex];
    const withState = (turnsRemaining: number): GameState => ({
      ...base.state,
      turnsRemaining,
      awaiting: { type: 'defuse_or_explode', playerId: cur.id, explodingCard: { id: 'ek1', type: CardType.ExplodingKitten } },
      players: base.state.players.map((p) =>
        p.id === cur.id ? { ...p, hand: [{ id: 'd1', type: CardType.Defuse }] } : p,
      ),
    });

    const buryView = projectView(withState(3), 'ROOM', cur.id, null, 0);
    const bury = decideBotMove(buryView, 'hard', makeRand(1));
    expect(bury).toMatchObject({ t: 'defuse', insertPosition: buryView.drawPileCount });

    const topView = projectView(withState(1), 'ROOM', cur.id, null, 0);
    const top = decideBotMove(topView, 'hard', makeRand(1));
    expect(top).toMatchObject({ t: 'defuse', insertPosition: 0 });
  });
});
