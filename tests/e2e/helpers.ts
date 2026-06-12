import { type Browser, type BrowserContext, type Page, expect } from '@playwright/test';

/** A single player driven in their own browser context (isolated localStorage). */
export interface Player {
  context: BrowserContext;
  page: Page;
  name: string;
}

/** Create a fresh context+page for a player (isolated identity). */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page, name };
}

/** Host creates a room from the home page and returns the room code. */
export async function hostCreateRoom(player: Player): Promise<string> {
  await player.page.goto('/');
  await player.page.getByPlaceholder('e.g. Whiskers').fill(player.name);
  await player.page.getByRole('button', { name: /Create a game/ }).click();
  await player.page.waitForURL(/\/room\/[A-Z0-9]+/);
  const match = player.page.url().match(/\/room\/([A-Z0-9]+)/);
  if (!match) throw new Error('No room code in URL');
  // Wait until connected (lobby heading appears).
  await expect(player.page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  return match[1];
}

/** A guest joins an existing room by code, passing through the name gate. */
export async function joinRoom(player: Player, code: string): Promise<void> {
  await player.page.goto(`/room/${code}`);
  // Name gate appears for a fresh context.
  const nameInput = player.page.getByPlaceholder('Your name');
  await nameInput.fill(player.name);
  await player.page.getByRole('button', { name: 'Join game' }).click();
  await expect(player.page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
}

/** Find which player currently has the turn (shows the draw/end-turn button). */
export async function findActivePlayer(players: Player[]): Promise<Player | null> {
  for (const p of players) {
    const btn = p.page.getByRole('button', { name: /Draw & end turn/ });
    if (await btn.isVisible().catch(() => false)) return p;
  }
  return null;
}
