# 🙀 Exploding Kittens — online multiplayer clone

A faithful, animated, realtime multiplayer clone of the **Exploding Kittens** base game,
built on the Cloudflare stack.

> Rules, card names, counts, and turn flow follow the original base game. The artwork
> is **original** cat-themed art (emoji + CSS), not the copyrighted official illustrations.

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

Use Cloudflare's **native Git integration** (Workers Builds) — connect the repo in the
dashboard (Workers & Pages → the `exploding-kittens` Worker → Settings → Builds):

- Root directory: `apps/worker`
- Build command: `pnpm install && pnpm --filter @ek/shared build && pnpm --filter @ek/web build`
- Deploy command: `npx wrangler deploy`

`.github/workflows/deploy.yml` is intentionally **CI-only** (typecheck + unit tests) so
there's no double-deploy and no Cloudflare secrets stored in GitHub.

> The client talks to `/api` same-origin by default. `VITE_API_BASE` is an optional
> override only needed if you ever split the frontend onto a different host.

## Game rules implemented

Base deck (56 cards): 4 Exploding Kitten, 6 Defuse, 5 Nope, 4 Attack, 4 Skip, 4 Favor,
4 Shuffle, 5 See the Future, and 20 cat cards. Setup deals 7 + 1 Defuse; inserts
`players − 1` kittens and the leftover Defuse. Includes Attack stacking, the Nope/Yup
chain, Favor, See the Future (private), Shuffle, Defuse reinsertion, and all three
combos (pair = steal random, triple = name & take, five different = take from discard).
Last kitty standing wins.
