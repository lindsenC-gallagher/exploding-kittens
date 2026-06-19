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

- [ ] Make Defuse more obvious. Consider an animation of the cat or dog (depending on theme) defusing the bomb.
- [ ] In the game log, also include the player who played Nope.
- [ ] Add a pause so two players can't accidentally Nope at the same time.
- [ ] Give players more time to shuffle.

## Audio & visual

- [ ] Add cute background music that changes depending on the theme.

## Spectator mode

- [ ] Add a spectator mode that can see players' cards and the deck. Make it obvious when you are spectating.

## Docs

- [x] Add a changelog (Exploding Kittens and Love Letter).

## Bugs & verification

- [ ] Double-check the shuffling algorithm.
- [ ] Test the chain: Skip -> Nope -> Attack -> Nope.

## Questions to decide

- [ ] Can you Nope a Nope? Decide the rule, then support the chain if yes.
