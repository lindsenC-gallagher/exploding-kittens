/**
 * Viewport probe — drives a real 2-player game at a fixed screen size and runs a
 * battery of responsive-layout checks, then screenshots lobby + game table.
 *
 * Env:
 *   VP_NAME   label for this run (e.g. "narrow-phone")
 *   VP_W/VP_H viewport size in CSS px
 *   BASE_URL  origin to test (default: live prod)
 *   OUT_DIR   screenshot output dir (default: test-results/viewport)
 *
 * Emits a single JSON line prefixed `PROBE_RESULT ` with the findings, plus PNGs.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const NAME = process.env.VP_NAME ?? 'phone';
const W = Number(process.env.VP_W ?? 390);
const H = Number(process.env.VP_H ?? 844);
const BASE = process.env.BASE_URL ?? 'https://exploding-kittens.lindsen-cruz.workers.dev';
const OUT = process.env.OUT_DIR ?? join('test-results', 'viewport');
mkdirSync(OUT, { recursive: true });

const shot = (p, tag) => p.screenshot({ path: join(OUT, `${NAME}-${tag}.png`), fullPage: false });

/** Battery of layout checks run inside the page. Returns plain JSON. */
const PROBE = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const doc = document.scrollingElement;
  const horizOverflow = doc.scrollWidth - vw; // >0 means page scrolls sideways
  const desc = (el) => {
    const t = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
    const txt = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30);
    return el.tagName.toLowerCase() + t + (txt ? ' «' + txt + '»' : '');
  };
  // Elements that spill past the right edge or left edge of the viewport.
  const spillRight = [], spillLeft = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (r.right > vw + 2) spillRight.push({ el: desc(el), right: Math.round(r.right), w: Math.round(r.width) });
    if (r.left < -2) spillLeft.push({ el: desc(el), left: Math.round(r.left), w: Math.round(r.width) });
  }
  // De-dup by description, keep worst offender.
  const top = (arr, k) => Object.values(arr.reduce((m, x) => {
    if (!m[x.el] || Math.abs(x[k]) > Math.abs(m[x.el][k])) m[x.el] = x; return m;
  }, {})).sort((a, b) => Math.abs(b[k]) - Math.abs(a[k])).slice(0, 12);

  // Hand fan cards that are partly/fully off-screen horizontally.
  const handCards = [...document.querySelectorAll('.hand .card')];
  const cardsOffscreen = handCards.filter((c) => {
    const r = c.getBoundingClientRect();
    return r.left < -2 || r.right > vw + 2;
  }).length;

  // Does the fixed log overlap the hand or the action toolbar?
  const rectOf = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
  const intersects = (a, b) => a && b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const log = rectOf('.log'), hand = rectOf('.hand'), toolbar = rectOf('.toolbar');
  const logOverlapsHand = intersects(log, hand);
  const logOverlapsToolbar = intersects(log, toolbar);

  // Small tap targets (buttons under 36px in either dimension) — mobile usability.
  const smallButtons = [];
  for (const b of document.querySelectorAll('button')) {
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < 36 || r.height < 36) smallButtons.push({ el: desc(b), w: Math.round(r.width), h: Math.round(r.height) });
  }

  // Is the action toolbar's primary content reachable (not clipped under the log)?
  return {
    vw, vh, horizOverflow,
    spillRight: top(spillRight, 'right'),
    spillLeft: top(spillLeft, 'left'),
    handCardCount: handCards.length,
    cardsOffscreen,
    logOverlapsHand, logOverlapsToolbar,
    smallButtons: smallButtons.slice(0, 10),
  };
})()`;

async function run() {
  const browser = await chromium.launch();
  const findings = { name: NAME, viewport: { w: W, h: H }, base: BASE, lobby: {}, game: {}, errors: [] };
  const mkCtx = async () => {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: W < 768, hasTouch: true });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') findings.errors.push(m.text().slice(0, 200)); });
    return { ctx, page };
  };

  const host = await mkCtx();
  const guest = await mkCtx();
  try {
    // --- Host creates room ---
    await host.page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await host.page.getByPlaceholder('e.g. Whiskers').fill('Hostington');
    await host.page.getByRole('button', { name: /Create a game/ }).click();
    await host.page.waitForURL(/\/room\/[A-Z0-9]+/, { timeout: 20000 });
    const code = host.page.url().match(/\/room\/([A-Z0-9]+)/)[1];
    await host.page.getByRole('heading', { name: 'Lobby' }).waitFor({ timeout: 20000 });

    // --- Guest joins ---
    await guest.page.goto(BASE + '/room/' + code, { waitUntil: 'networkidle' });
    await guest.page.getByPlaceholder('Your name').fill('Guestopher');
    await guest.page.getByRole('button', { name: 'Join game' }).click();
    await guest.page.getByRole('heading', { name: 'Lobby' }).waitFor({ timeout: 20000 });

    await host.page.getByText(/2\/5 players/).waitFor({ timeout: 20000 });
    await shot(host.page, 'lobby-host');
    findings.lobby.host = await host.page.evaluate(PROBE);

    // --- Start game ---
    await host.page.getByRole('button', { name: /Start game/ }).click();
    await host.page.locator('.hand .card').first().waitFor({ timeout: 20000 });
    await guest.page.locator('.hand .card').first().waitFor({ timeout: 20000 });
    await host.page.waitForTimeout(1200); // settle fan/animations

    await shot(host.page, 'game-host');
    await shot(guest.page, 'game-guest');
    findings.game.host = await host.page.evaluate(PROBE);
    findings.game.guest = await guest.page.evaluate(PROBE);

    // --- Open the Help modal (host) and screenshot — it's a big responsive grid ---
    try {
      const helpFab = host.page.locator('.help-fab');
      await helpFab.click({ timeout: 5000, force: true });
      await host.page.waitForTimeout(400);
      await shot(host.page, 'help-host');
      findings.game.helpModal = await host.page.evaluate(PROBE);
    } catch (e) {
      findings.errors.push('HELP: ' + (e?.message ?? String(e)).slice(0, 120));
    }
  } catch (e) {
    findings.errors.push('FLOW: ' + (e?.message ?? String(e)).slice(0, 300));
  } finally {
    await browser.close();
  }
  console.log('PROBE_RESULT ' + JSON.stringify(findings));
}
run();
