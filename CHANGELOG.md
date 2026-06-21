# Changelog

All notable changes to this project are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This project deploys continuously: every push to `main` ships to production, so
there are no tagged releases. Entries are grouped by date instead of version.

## [Unreleased]

### Fixed

- The end-to-end test suite now matches the lobby player count regardless of the
  table size, so it no longer breaks when the maximum jumps from 5 to 9 players.
  No player-facing change; the deployed game was already correct.
- The spectator unit test no longer assumes a fixed player order, so it stays
  stable now that turn order is randomised on game start. No player-facing change.

## 2026-06-19

### Changed

- The Nope window is now 5 seconds, giving the table more time to react before an
  action resolves.
- An Attack or Skip that has already resolved onto you can now be bounced back to
  the player who played it, by Noping at the very start of your turn (before you
  play or draw).

### Fixed

- Players now keep a fixed seat order in the turn-order display, instead of the
  cards reordering as turns progress.

## 2026-06-18

### Added

- Hover tooltips on the cards in your hand, describing what each one does.
- The current player is pinned to the top of the turn-order cards.

### Fixed

- The game table is now responsive on phones and tablets.

## 2026-06-17

### Added

- Host-selectable card-art theme with a dogs skin alongside the classic cats art.
- Player avatars, a fanned hand layout, a turn-order display, and sound effects.

### Changed

- The blind-steal window was tuned to 3 seconds, and the event log gained
  minimise / maximise controls.

### Fixed

- Card names are now theme-aware, and cat emoji no longer leak through in the dog
  skin.

## 2026-06-16

### Added

- House rules: the host can toggle individual combos on or off in the lobby (pair
  steal, three-of-a-kind demand, and the five-different rule).
- Face-up reveal of a drawn card as it flies into your hand.
- A computed, always-accurate help sheet and a collapsible event log.

### Changed

- The "card played" banner is now anchored so it stays in view.

## 2026-06-15

### Added

- Richer gameplay UX: drag to play from your hand, blind steal selection,
  animations, and in-game help.

### Fixed

- Several bugs found in a multi-agent test pass: the Nope "Yup" counter, event log
  ordering, a per-seat token leak, and combo handling on cat cards.

## 2026-06-12

### Added

- Initial release: a faithful, animated, realtime multiplayer Exploding Kittens
  clone on the Cloudflare stack.
- The full base game served from a single Worker: the React client (as static
  assets), the `/api` routes, and one `GameRoom` Durable Object per room.
- Server-authoritative play with redacted per-player views, so other hands and the
  draw-pile order never leave the server.
- Security hardening: runtime-validated client messages, per-seat auth, a
  Content-Security-Policy and security headers, and an origin allowlist.
