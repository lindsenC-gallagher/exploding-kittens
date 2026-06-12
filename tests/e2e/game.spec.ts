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
