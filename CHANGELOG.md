# Changelog

All notable changes to this project are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This project deploys continuously: every push to `main` ships to production, so
there are no tagged releases. Entries are grouped by date instead of version.

## [Unreleased]

### Added

- You can now mute background music and sound effects separately. The top-right
  cluster has two toggles: a speaker for sound effects and a music note for the
  background loop. Each remembers its own on/off setting between visits.
- Spectators can now see the live game log while watching, the same running
  feed of plays, draws, Nopes and explosions that seated players get.

### Changed

- When defusing, the deck slot where the Exploding Kitten will be hidden is now
  shown clearly as you choose. A live 1-based slot number rides along with the
  insertion marker as you drag (so the top slot reads "1st — next draw" instead
  of "position 0"), and the badge under the deck spells out the chosen slot.
- You now drop into spectator mode automatically: when you're knocked out of a
  game, and when you open a room whose game is already underway (or whose lobby is
  full). Eliminated players keep their seat and rejoin as a player when the host
  starts the next game.
- In spectator mode the draw pile now stays face-down until you click it, so the
  deck order isn't spoiled the moment you start watching. Click again to hide it.
- The spectator banner now explains why you're watching, for example "you're out,
  watching till the next game" when you've been knocked out, or "this game's
  already underway" when you join a room mid-game.

### Fixed

- The Spectating banner no longer covers the floating Help and What's-new
  buttons in the top-right corner, so they stay visible and clickable while you
  watch. The banner now sits behind those buttons and reserves room for them, on
  both desktop and phone widths. The bottom-right game log was already clear of
  the banner.
- On phones the "Phew — Defused!" dialog no longer runs off the screen. Its
  title, the deck end-labels, and the Top/Middle/Bottom shortcut buttons were
  being clipped past the edges on narrow screens. The dialog now shrinks its
  padding and lets the buttons and labels wrap so everything stays on-screen.
- Getting knocked out by the explosion that ends the game now shows you the
  spectator reveal too. Previously the player whose blast ended the game (and
  both players in a two-player game) jumped straight to the win screen and never
  got to see the final hands or the deck. If you're the host, you can still start
  the next game straight from the spectator screen.
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
