# 🙀 Exploding Kittens — online multiplayer clone

A faithful, animated, realtime multiplayer clone of the **Exploding Kittens** base game,
built on the Cloudflare stack.

> Rules, card names, counts, and turn flow follow the original base game. The artwork
> is **original** art (emoji + CSS), not the copyrighted official illustrations. The host
> picks a card-art theme in the lobby — classic **cats** 🐱 or a **dogs** 🐶 skin.

**▶ Play it live: https://exploding-kittens.lindsen-cruz.workers.dev/**

See [CHANGELOG.md](CHANGELOG.md) for the history of changes.

## Stack

| Layer       | Tech                                                                 |
| ----------- | -------------------------------------------------------------------- |
| Frontend    | React + TypeScript + Vite + Framer Motion (Cloudflare Pages)         |
| Realtime    | Cloudflare **Workers + Durable Objects** (one `GameRoom` per room)   |
| Rules engine| Pure, deterministic TypeScript in `@ek/shared` (seeded RNG)          |
| Tests       | Vitest (engine) + Playwright (multi-player e2e)                      |

The game is **server-authoritative**: the Durable Object holds the only true game
state and sends each player a redacted view — you never receive other players' hands
or the draw-pile order.

## Project layout

```
packages/shared   @ek/shared — cards, rules engine, wire protocol, view projection
apps/worker       Worker routes + GameRoom Durable Object
apps/web          React client (lobby + animated game table)
tests/e2e         Playwright multi-context scenarios
```

## Develop locally

```bash
pnpm install
pnpm dev          # runs the worker (:8787) and the web app (:5173) together
```

Open http://localhost:5173, create a game, and share the room code (open a second
browser / private window to join as another player). Vite proxies `/api` (HTTP + WS)
to the worker, so everything is same-origin in dev.

## Test

```bash
pnpm test         # Vitest — the faithful rules engine (deterministic, seeded)
pnpm test:e2e     # Playwright — realtime lobby + game across two players
```

## Deploy (Cloudflare)

A **single Worker** serves everything: the built React app (as static assets), the
`/api` routes, and the `GameRoom` Durable Object. One deploy ships the whole game,
and the WebSocket is same-origin (no CORS, no separate frontend host).

Build then deploy:

```bash
pnpm --filter @ek/web build           # produces apps/web/dist (served as assets)
pnpm --filter @ek/worker exec wrangler deploy
```

### Auto-deploy on push

Deploys run from **GitHub Actions** (`.github/workflows/deploy.yml`). On every push to
`main` the workflow runs `test → deploy → e2e`: unit tests + typecheck, then build and
`wrangler deploy` the Worker, then the Playwright suite against the live production URL.

Set two repo secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — a token using the **Edit Cloudflare Workers** template
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id

> **Do not also connect Cloudflare's native Git integration (Workers Builds)** — if both
> are active you'll deploy twice per push. GitHub Actions is the single deploy path.

> The client talks to `/api` same-origin by default. `VITE_API_BASE` is an optional
> override only needed if you ever split the frontend onto a different host.

## Security model

The game is anonymous (no accounts), but it defends the things that matter for a
fair realtime game:

- **Per-seat auth.** On first join, a player's browser-generated id (`pid`) is bound
  to a server-minted secret **token** (sent once over the socket, stored per-room in
  `localStorage`). Every later connection must present that token — `pid`s are public
  (broadcast to the room), so this stops anyone from impersonating another seat, reading
  their hand, or acting as them. There is no token-less "reclaim".
- **Server-authoritative + redacted views.** The Durable Object holds the only true
  state and projects a per-player view; other hands and the draw-pile order never leave
  the server. A drawn Exploding Kitten is held off-pile during a defuse, so it isn't
  leaked on the public discard.
- **Unpredictable shuffles.** Deck order and "random" steals are seeded from
  `crypto.getRandomValues` on the server, not from public game state — the deck can't be
  predicted or brute-forced.
- **Validated input.** Every WebSocket frame is runtime-validated (`parseClientMessage`)
  and the engine call is wrapped in `try/catch`, so malformed messages are dropped, never
  crashing the room. Frames are size-capped and per-socket rate-limited.
- **Browser hardening.** The Worker serves the SPA with a Content-Security-Policy plus
  `nosniff` / `no-referrer` / `frame-ancestors 'none'`; API responses are `no-store` with
  a locked-down CSP.
- **Origin control.** CORS and the WebSocket upgrade honor an origin allowlist. By default
  it permits `localhost` and `*.pages.dev` / `*.workers.dev`; set the `ALLOWED_ORIGINS`
  Worker var (comma-separated) to your exact origin(s) in production. Room codes are
  validated and drawn from a ~1e9 space to resist enumeration.

## Game rules implemented

Base deck (56 cards): 4 Exploding Kitten, 6 Defuse, 5 Nope, 4 Attack, 4 Skip, 4 Favor,
4 Shuffle, 5 See the Future, and 20 cat cards. Setup deals 7 + 1 Defuse; inserts
`players − 1` kittens and the leftover Defuse. Includes Attack stacking, the Nope/Yup
chain, Favor, See the Future (private), Shuffle, Defuse reinsertion, and all three
combos (pair = steal random, triple = name & take, five different = take from discard).
Last kitty standing wins.

**Nope timing.** A played action sits in a shared 5-second Nope window (resets on each
Nope, capped at 20s) during which anyone holding a Nope can cancel it. On top of that, an
Attack or Skip that has already resolved onto you can still be Noped at the very start of
your turn, before you play or draw, which bounces the turn back to the player who played it.

**House rules.** In the lobby the host can toggle individual combos on/off (pair,
three-of-a-kind, and the five-different "5-card rule"); the setting syncs to every
player and the engine rejects a disabled combo. All default to on (the faithful base game).

**Card art theme.** The host also picks a cosmetic card-art skin in the lobby — classic
**cats** 🐱 (default) or **dogs** 🐶. It's purely visual (no rules change), syncs to every
player, and applies across hands, piles, overlays, the log, and the help sheet.
