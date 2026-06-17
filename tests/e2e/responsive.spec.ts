import { test, expect } from '@playwright/test';

/**
 * Responsive-layout regression guard.
 *
 * The game table is built around fixed card sizes and a non-wrapping fan hand,
 * which together demanded ~750px of width. On narrower screens the browser
 * shrink-to-fit the page (body has `overflow-x: hidden`), so the whole table
 * zoomed out and the fan's edge cards were clipped off-screen — the game was
 * effectively unplayable on phones. Responsive breakpoints in `index.css` scale
 * the card variables / fan overlap so the table genuinely fits.
 *
 * These tests drive a real 2-player game at phone/tablet viewports and assert:
 *   1. no shrink-to-fit — the layout viewport width matches the device width;
 *   2. no hand card spills past either edge of the viewport.
 */

const VIEWPORTS = [
  { name: 'narrow phone', width: 320, height: 568 },
  { name: 'small phone', width: 360, height: 640 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
] as const;

for (const vp of VIEWPORTS) {
  test(`game table fits ${vp.name} (${vp.width}x${vp.height}) without overflow or clipped cards`, async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const opts = {
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.width < 768,
      hasTouch: true,
    };
    const hostCtx = await browser.newContext(opts);
    const guestCtx = await browser.newContext(opts);
    try {
      const host = await hostCtx.newPage();
      const guest = await guestCtx.newPage();

      // Host creates a room.
      await host.goto('/');
      await host.getByPlaceholder('e.g. Whiskers').fill('Host');
      await host.getByRole('button', { name: /Create a game/ }).click();
      await host.waitForURL(/\/room\/[A-Z0-9]+/);
      const code = host.url().match(/\/room\/([A-Z0-9]+)/)![1];
      await expect(host.getByRole('heading', { name: 'Lobby' })).toBeVisible();

      // Guest joins.
      await guest.goto(`/room/${code}`);
      await guest.getByPlaceholder('Your name').fill('Guest');
      await guest.getByRole('button', { name: 'Join game' }).click();
      await expect(guest.getByRole('heading', { name: 'Lobby' })).toBeVisible();
      await expect(host.getByText(/2\/5 players/)).toBeVisible();

      // Start — a full 8-card hand is dealt.
      await host.getByRole('button', { name: /Start game/ }).click();
      await expect(host.locator('.hand .card')).toHaveCount(8);
      await host.waitForTimeout(800); // let the fan settle

      for (const page of [host, guest]) {
        const m = await page.evaluate(() => {
          const vw = window.innerWidth;
          const overflow = document.scrollingElement!.scrollWidth - vw;
          const offscreen = [...document.querySelectorAll('.hand .card')].filter((c) => {
            const r = c.getBoundingClientRect();
            return r.left < -2 || r.right > vw + 2;
          }).length;
          return { vw, overflow, offscreen };
        });
        // No shrink-to-fit: the layout viewport must equal the device width
        // (a blowout would report a much larger innerWidth, e.g. ~748).
        expect(m.vw, 'layout viewport should match device width (no shrink-to-fit)').toBeLessThanOrEqual(
          vp.width + 4,
        );
        expect(m.overflow, 'no horizontal page overflow').toBeLessThanOrEqual(2);
        expect(m.offscreen, 'no hand card clipped past a viewport edge').toBe(0);
      }
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
}
