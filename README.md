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

Pushing to `main` auto-deploys via `.github/workflows/deploy.yml`:

1. **test** — unit tests + typecheck
2. **deploy-worker** — `wrangler deploy` (Worker + Durable Object)
3. **deploy-web** — build with `VITE_API_BASE` → `wrangler pages deploy`

Configure these in the GitHub repo:

- Secrets: `CLOUDFLARE_API_TOKEN` (Workers + Pages edit), `CLOUDFLARE_ACCOUNT_ID`
- Variable: `VITE_API_BASE` — the deployed Worker origin
  (e.g. `https://exploding-kittens-worker.<subdomain>.workers.dev`)

The client reads `VITE_API_BASE` to reach the Worker (REST + WebSocket) cross-origin in
production; in dev it's unset and uses the same-origin Vite proxy.

## Game rules implemented

Base deck (56 cards): 4 Exploding Kitten, 6 Defuse, 5 Nope, 4 Attack, 4 Skip, 4 Favor,
4 Shuffle, 5 See the Future, and 20 cat cards. Setup deals 7 + 1 Defuse; inserts
`players − 1` kittens and the leftover Defuse. Includes Attack stacking, the Nope/Yup
chain, Favor, See the Future (private), Shuffle, Defuse reinsertion, and all three
combos (pair = steal random, triple = name & take, five different = take from discard).
Last kitty standing wins.
