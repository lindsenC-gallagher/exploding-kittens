# TODO

Backlog of ideas and improvements for the game. Grouped by theme. Unchecked items are not started.

## Gameplay rules

- [x] Randomise the player turn order. Don't base it on lobby join order, and reshuffle it every round, not just once per room.
- [x] Add an option to not stack Attack, so the maximum is 2 turns.
- [x] Allow more than 5 players.

## Lobby & setup

- [x] Allow the host to start a new game without creating a new lobby.
- [x] Allow changing your name after joining, while in the lobby, but not during the game.
- [x] Randomise the emoji pick after a player joins, preferring emojis nobody has picked yet.

## UX & polish

- [x] Make Defuse more obvious. Consider an animation of the cat or dog (depending on theme) defusing the bomb.
- [x] In the game log, also include the player who played Nope.
- [x] Add a pause so two players can't accidentally Nope at the same time.
- [x] Give players more time to shuffle.

## Audio & visual

- [x] Add cute background music that changes depending on the theme.

## Spectator mode

- [x] Add a spectator mode that can see players' cards and the deck. Make it obvious when you are spectating.

## Docs

- [x] Add a changelog (Exploding Kittens and Love Letter).

## Bugs & verification

- [x] Double-check the shuffling algorithm.
- [x] Test the chain: Skip -> Nope -> Attack -> Nope.

## Questions to decide

- [x] Can you Nope a Nope? Decided: yes (the "Yup"). Already supported by the stacked-Nope engine; covered by tests.

## New ideas (with Love Letter relevance)

Whether each idea also applies to the sibling **Love Letter** project (`../love-letter`).
Love Letter is a close architectural sibling (round-based, server-authoritative Durable
Object) and already has a spectator view, an event log, a combined mute button,
synthesized music + SFX, and per-player discard piles. Those existing pieces decide
whether each idea transfers.

**Love Letter key:** ✅ useful · ❌ not applicable · ❓ likely already done (verify) · ⚠️ needs adaptation

### ✅ Useful for Love Letter

- [x] Spectators should be able to see the game log. *(LL: has `EventLog`, but `SpectatorView` doesn't render it)*
- [x] Make sure the spectator banner doesn't hide anything. *(LL: has a `spectator-banner`; same layering risk)*
- [x] Ability to mute bg music and sound effects separately. *(LL: mute is a single combined toggle today)*

### ❌ Not applicable to Love Letter

- [x] After defuse, show the card position number when choosing where to put the Exploding Kitten. *(LL: no defuse / kitten-placement mechanic)*
- [x] Too many cards with 6 players — use half the deck? *(LL: fixed 16-card deck, max 4 players)*

### ❓ Likely already done in Love Letter (verify)

- [x] See all discard cards as spectator. *(LL: spectator already showed each player's `played:` discard — verified, no change)*
- [x] Allow spectator to see all of the discard pile. *(LL: duplicate of the above; verified already done)*

### ⚠️ Needs adaptation for Love Letter

- [x] Home rule to change the number of starting cards. *(EK only — `startingHandSize` option, bounds 1-10, default 7. LL N/A: always deals 1 card; its host-custom rule is the token target.)*
- [x] When the game is over, don't show spectator mode — show the game-over screen. *(EK: covered by the winner dialog. LL: dedicated `EndScreen` with cards + tokens replaces the reveal.)*
- [x] No spectators once the game has started — only players; show "round ongoing, you'll join next round". *(EK: "game in progress, join next game". Mid-game newcomers wait + auto-seat; watch-link hole closed.)*
- [x] Still show "exploded" for a few seconds before dropping the current player into spectator mode. *(EK: 2.8s explosion hold. LL: 2.2s "you're out" beat.)*
- [x] As a spectator, when the game ends with a winner, show a closeable dialog over the spectator screen naming the winner. *(EK: dismissable winner dialog over the reveal. LL: satisfied by the `EndScreen`.)*

Notes:
- "See all discard cards as spectator" and "Allow spectator to see all of the discard pile" are the same request.
- Game-over-while-spectating decision (covers both the "game over screen" and "winner dialog" items):
  - Exploding Kittens: floating winner dialog you can close; closing it shows the normal spectator reveal.
  - Love Letter: always show a dedicated end screen with each player's cards and token counts (names the winner).
- "Home rule to change the number of starting cards" is Exploding Kittens only — Love Letter always deals 1 card; its host-custom rule is the token target, which already exists.
