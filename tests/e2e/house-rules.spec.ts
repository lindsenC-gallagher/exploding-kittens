import { test, expect } from '@playwright/test';
import { hostCreateRoom, joinRoom, newPlayer, type Player } from './helpers.js';

/**
 * Covers the lobby "house rules" toggles (host-only, synced to everyone) and the
 * game log's explicit minimize / maximize controls.
 */
test.describe('Exploding Kittens — house rules & log', () => {
  let players: Player[] = [];

  test.afterEach(async () => {
    for (const p of players) await p.context.close();
    players = [];
  });

  test('host can disable a rule and it syncs to the guest (read-only)', async ({ browser }) => {
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/\d+ players/)).toBeVisible();

    const hostRule = host.page.locator('.rule-toggle', { hasText: 'Five different' });
    const guestRule = guest.page.locator('.rule-toggle', { hasText: 'Five different' });

    // Defaults: enabled everywhere; the guest's copy is read-only.
    await expect(hostRule).toHaveAttribute('aria-pressed', 'true');
    await expect(guestRule).toHaveAttribute('aria-pressed', 'true');
    await expect(guestRule).toBeDisabled();

    // Host turns the "5-card rule" off; it propagates to the guest in realtime.
    await hostRule.click();
    await expect(hostRule).toHaveAttribute('aria-pressed', 'false');
    await expect(hostRule.locator('.rule-state')).toHaveText('Off');
    await expect(guestRule).toHaveAttribute('aria-pressed', 'false');
    await expect(guestRule.locator('.rule-state')).toHaveText('Off');
  });

  test('host picks the dogs theme; it syncs (read-only) and swaps the card art', async ({
    browser,
  }) => {
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/\d+ players/)).toBeVisible();

    const hostCats = host.page.locator('.theme-pick', { hasText: 'Cats' });
    const hostDogs = host.page.locator('.theme-pick', { hasText: 'Dogs' });
    const guestDogs = guest.page.locator('.theme-pick', { hasText: 'Dogs' });

    // Default: cats selected everywhere; the guest's picker is read-only.
    await expect(hostCats).toHaveAttribute('aria-pressed', 'true');
    await expect(hostDogs).toHaveAttribute('aria-pressed', 'false');
    await expect(guestDogs).toBeDisabled();

    // Host switches to dogs; it propagates to the guest in realtime.
    await hostDogs.click();
    await expect(hostDogs).toHaveAttribute('aria-pressed', 'true');
    await expect(guestDogs).toHaveAttribute('aria-pressed', 'true');

    // The art swap reaches the table: the help sheet reads "How to play 🐶".
    await host.page.getByRole('button', { name: /Start game/ }).click();
    await expect(host.page.locator('.hand .card')).toHaveCount(8);
    await host.page.getByRole('button', { name: 'Help & rules' }).click();
    await expect(host.page.getByRole('heading', { name: /How to play 🐶/ })).toBeVisible();
    // Naming follows the skin too: dog wording shows, no "cat" naming leaks.
    // "Exploding Puppy" appears in more than one place (the card itself plus the
    // Defuse wording / hand tooltips), so assert at least one is visible.
    await expect(host.page.getByText(/Exploding Puppy/).first()).toBeVisible();
    await expect(host.page.getByText(/Dog Cards/)).toBeVisible();
    await expect(host.page.getByText(/Exploding Kitten/)).toHaveCount(0);
  });

  test('a chosen avatar syncs to other players in the lobby', async ({ browser }) => {
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/\d+ players/)).toBeVisible();

    // Host picks the unicorn; their pick reflects as selected...
    const pick = host.page.locator('.avatar-pick', { hasText: '🦄' });
    await pick.click();
    await expect(pick).toHaveAttribute('aria-pressed', 'true');

    // ...and the guest sees the host's lobby row update to that avatar.
    const hostRow = guest.page.locator('.row', { hasText: 'Whiskers' }).first();
    await expect(hostRow).toContainText('🦄');
  });

  test('the game log resizes via explicit minimize / maximize controls', async ({ browser }) => {
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/\d+ players/)).toBeVisible();
    await host.page.getByRole('button', { name: /Start game/ }).click();
    await expect(host.page.locator('.hand .card')).toHaveCount(8);

    const log = host.page.locator('.log');
    const body = host.page.locator('.log .log-body');

    // Default: normal size, body visible (no hover needed).
    await expect(log).toHaveClass(/\bnormal\b/);
    await expect(body).toBeVisible();

    // Maximize: the log grows and the body stays visible.
    await host.page.getByRole('button', { name: 'Maximize log' }).click();
    await expect(log).toHaveClass(/\bmax\b/);
    await expect(body).toBeVisible();

    // Minimize: only the title bar remains (body hidden).
    await host.page.getByRole('button', { name: 'Minimize log' }).click();
    await expect(log).toHaveClass(/\bmin\b/);
    await expect(body).toBeHidden();

    // Expand back from minimized restores the body.
    await host.page.getByRole('button', { name: 'Expand log' }).click();
    await expect(log).toHaveClass(/\bnormal\b/);
    await expect(body).toBeVisible();
  });
});
