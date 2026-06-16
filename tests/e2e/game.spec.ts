import { test, expect } from '@playwright/test';
import { findActivePlayer, hostCreateRoom, joinRoom, newPlayer, type Player } from './helpers.js';

test.describe('Exploding Kittens — realtime multiplayer', () => {
  let players: Player[] = [];

  test.afterEach(async () => {
    for (const p of players) await p.context.close();
    players = [];
  });

  test('lobby syncs in realtime across players', async ({ browser }) => {
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    // Host initially sees 1 player.
    await expect(host.page.getByText(/1\/5 players/)).toBeVisible();

    await joinRoom(guest, code);

    // Both pages should now show 2 players, in realtime.
    await expect(host.page.getByText(/2\/5 players/)).toBeVisible();
    await expect(guest.page.getByText(/2\/5 players/)).toBeVisible();
    // Both player names appear in the host's lobby.
    await expect(host.page.getByText('Whiskers')).toBeVisible();
    await expect(host.page.getByText('Mittens')).toBeVisible();
  });

  test('host starts the game and both players are dealt 8 cards', async ({ browser }) => {
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/5 players/)).toBeVisible();

    await host.page.getByRole('button', { name: /Start game/ }).click();

    // Both reach the table: a hand of 8 cards is rendered for each.
    await expect(host.page.locator('.hand .card')).toHaveCount(8);
    await expect(guest.page.locator('.hand .card')).toHaveCount(8);

    // Exactly one player should have the active turn.
    const active = await findActivePlayer(players);
    expect(active).not.toBeNull();
  });

  test('table shows the draggable hand and the game log', async ({ browser }) => {
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/5 players/)).toBeVisible();
    await host.page.getByRole('button', { name: /Start game/ }).click();
    await expect(host.page.locator('.hand .card')).toHaveCount(8);

    // Feature 2: each hand card is wrapped in a draggable item + a drag hint.
    await expect(host.page.locator('.hand .hand-item')).toHaveCount(8);
    await expect(host.page.getByText(/drag to rearrange your hand/i)).toBeVisible();
    // Feature 1: the (bigger) game log is present with its header.
    await expect(host.page.locator('.log .log-title')).toBeVisible();

    await host.page.screenshot({ path: 'test-results/game-table.png' });
  });

  test('dragging a hand card reorders the hand (and persists)', async ({ browser }) => {
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/5 players/)).toBeVisible();
    await host.page.getByRole('button', { name: /Start game/ }).click();
    await expect(host.page.locator('.hand .hand-item')).toHaveCount(8);

    const items = host.page.locator('.hand .hand-item');
    const before = await items.evaluateAll((els) => els.map((e) => e.textContent));

    // Drag the first card to roughly where the 4th card sits (pointer-based, so
    // framer-motion's Reorder picks it up). Several moves to cross the threshold.
    const first = await items.first().boundingBox();
    const fourth = await items.nth(3).boundingBox();
    if (!first || !fourth) throw new Error('no bounding boxes');
    await host.page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await host.page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await host.page.mouse.move(
        first.x + ((fourth.x - first.x) * i) / 6 + first.width / 2,
        first.y + first.height / 2,
        { steps: 3 },
      );
    }
    await host.page.mouse.up();

    // The order should have changed locally...
    await expect
      .poll(async () => (await items.evaluateAll((els) => els.map((e) => e.textContent))).join('|'))
      .not.toBe(before.join('|'));

    // ...and survive a reload (it was persisted server-side).
    const afterDrag = await items.evaluateAll((els) => els.map((e) => e.textContent));
    await host.page.reload();
    await expect(host.page.locator('.hand .hand-item')).toHaveCount(8);
    const afterReload = await host.page
      .locator('.hand .hand-item')
      .evaluateAll((els) => els.map((e) => e.textContent));
    expect(afterReload).toEqual(afterDrag);
  });

  test('drawing the Exploding Kitten shows the deck-placement defuse prompt', async ({ browser }) => {
    test.setTimeout(90_000);
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/5 players/)).toBeVisible();
    await host.page.getByRole('button', { name: /Start game/ }).click();
    await expect(host.page.locator('.hand .card')).toHaveCount(8);

    // Everyone is dealt a Defuse, so the first Exploding Kitten drawn always opens
    // the placement prompt (it's somewhere in the deck — guaranteed within a pass).
    let prompted: Player | null = null;
    for (let i = 0; i < 90 && !prompted; i++) {
      for (const p of players) {
        if (await p.page.getByText(/Phew — Defused/).isVisible().catch(() => false)) {
          prompted = p;
          break;
        }
      }
      if (prompted) break;
      const drawer = await findActivePlayer(players);
      if (!drawer) {
        await players[0].page.waitForTimeout(120);
        continue;
      }
      await drawer.page.getByRole('button', { name: /Draw & end turn/ }).click();
      await drawer.page.waitForTimeout(110);
    }
    expect(prompted).not.toBeNull();

    // Feature: the deck is shown as an overlapping fan with a draggable kitten and
    // Top / Middle / Bottom shortcuts (replacing the old slider).
    await expect(prompted!.page.locator('.defuse-deck')).toBeVisible();
    await expect(prompted!.page.locator('.defuse-kitten')).toBeVisible();
    await expect(prompted!.page.getByRole('button', { name: /Top \(evil\)/ })).toBeVisible();
    await expect(prompted!.page.getByRole('button', { name: /Middle/ })).toBeVisible();
    await expect(prompted!.page.getByRole('button', { name: /Bottom/ })).toBeVisible();
  });

  test('drawing a card passes the turn to the next player', async ({ browser }) => {
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/5 players/)).toBeVisible();
    await host.page.getByRole('button', { name: /Start game/ }).click();
    await expect(host.page.locator('.hand .card')).toHaveCount(8);

    const active = await findActivePlayer(players);
    expect(active).not.toBeNull();
    const other = players.find((p) => p !== active)!;

    // The active player draws (ends their turn) — unless they explode, the turn
    // moves to the other player, who then sees the draw/end-turn control.
    await active!.page.getByRole('button', { name: /Draw & end turn/ }).click();

    // The other player should become active (their hand grew to 8 or 9, and
    // their draw button appears). Allow for the rare immediate explosion.
    await expect
      .poll(async () => {
        const nowActive = await findActivePlayer(players);
        return nowActive?.name ?? null;
      })
      .not.toBe(active!.name);
  });
});
