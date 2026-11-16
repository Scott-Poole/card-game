# Card game

The language of a match and the players taking part in it.

## Language

**Player**:
A participant making decisions for one side of a match, whether controlled by a human or a bot.
_Avoid_: User (when referring to a match participant)

**Seat**:
A player's assigned side in a particular match, independent of how that player connects.
_Avoid_: Connection, socket (when referring to the assigned side)

**View**:
The information a particular player is allowed to see about a match, including their own private information and the opponent's public information.
_Avoid_: Match state (when referring to a player's knowledge)

**Protocol client**:
A player-facing participant that exchanges game messages with the authoritative server and makes decisions from its view, whether it is a browser or a bot.
_Avoid_: Engine caller (when referring to a player)
