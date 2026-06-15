import { test, expect } from '@playwright/test';
import { findActivePlayer, hostCreateRoom, joinRoom, newPlayer, type Player } from './helpers.js';

/**
 * Regression guard for the dropped-event bug: when an action resolved with no
 * eligible Noper, the server emits `cards_played` immediately followed by the
 * resolution batch, and the client used to overwrite the first with the second
 * — silently losing the "X played Y" log line and the played banner. This drives
 * a real two-player game, plays a single-action card, and asserts the play is
 * recorded in the game log on both clients.
 */

/** Single-action cards that play outright (no target / discard / name flow). */
const PLAYABLE_SINGLE = ['Skip', 'Attack', 'Shuffle', 'See the Future'];

test.describe('Exploding Kittens — event log', () => {
  let players: Player[] = [];

  test.afterEach(async () => {
    for (const p of players) await p.context.close();
    players = [];
  });

  test('a played action card is recorded in the game log on both clients', async ({ browser }) => {
    test.setTimeout(60_000);
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/5 players/)).toBeVisible();
    await host.page.getByRole('button', { name: /Start game/ }).click();
    await expect(host.page.locator('.hand .card')).toHaveCount(8);

    // Play the first single-action card the active player holds (if any).
    async function tryPlayFrom(p: Player): Promise<string | null> {
      for (const name of PLAYABLE_SINGLE) {
        const card = p.page.locator('.hand .card', { hasText: name }).first();
        if (!(await card.isVisible().catch(() => false))) continue;
        await card.click();
        const playBtn = p.page.getByRole('button', { name: /Play card/ });
        if (!(await playBtn.isVisible().catch(() => false))) {
          await card.click(); // deselect and try the next type
          continue;
        }
        await playBtn.click();
        return name;
      }
      return null;
    }

    // Try the current active player; if they hold no playable single action,
    // end their turn (draw) and try whoever is active next. Bounded retries.
    let played: string | null = null;
    let actor: Player | null = null;
    for (let attempt = 0; attempt < 4 && !played; attempt++) {
      actor = await findActivePlayer(players);
      if (!actor) {
        await players[0].page.waitForTimeout(150);
        continue;
      }
      played = await tryPlayFrom(actor);
      if (played) break;
      await actor.page.getByRole('button', { name: /Draw & end turn/ }).click();
      await actor.page.waitForTimeout(250);
    }

    expect(played, 'expected the active player to hold a playable single-action card').not.toBeNull();

    // The play must appear in the log for the actor ("You played …") and for the
    // opponent ("<name> played …") — i.e. the cards_played event was not dropped.
    const opponent = players.find((p) => p !== actor)!;
    await expect(actor!.page.locator('.log .log-body')).toContainText(`played ${played}`);
    await expect(opponent.page.locator('.log .log-body')).toContainText(`played ${played}`);
  });
});
