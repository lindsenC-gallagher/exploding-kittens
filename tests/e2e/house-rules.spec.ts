import { test, expect } from '@playwright/test';
import { hostCreateRoom, joinRoom, newPlayer, type Player } from './helpers.js';

/**
 * Covers the lobby "house rules" toggles (host-only, synced to everyone) and the
 * game log's collapse / hover-to-expand behaviour.
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
    await expect(host.page.getByText(/2\/5 players/)).toBeVisible();

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

  test('the game log is collapsed by default and expands on hover', async ({ browser }) => {
    const host = await newPlayer(browser, 'Whiskers');
    const guest = await newPlayer(browser, 'Mittens');
    players = [host, guest];

    const code = await hostCreateRoom(host);
    await joinRoom(guest, code);
    await expect(host.page.getByText(/2\/5 players/)).toBeVisible();
    await host.page.getByRole('button', { name: /Start game/ }).click();
    await expect(host.page.locator('.hand .card')).toHaveCount(8);

    const log = host.page.locator('.log');
    const opacity = () => log.evaluate((el) => getComputedStyle(el).opacity);
    const maxHeight = () => log.evaluate((el) => getComputedStyle(el).maxHeight);

    // Collapsed: dimmed and short.
    expect(await opacity()).toBe('0.62');
    expect(await maxHeight()).toBe('118px');

    // Hovering expands it: fully opaque and taller.
    await log.hover();
    await expect.poll(opacity).toBe('1');
    await expect.poll(async () => (await maxHeight()) !== '118px').toBe(true);
  });
});
