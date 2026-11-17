# Card game

The language of a match and the players taking part in it.

## Players

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

## Match flow

**Match**:
A contest between two players over up to six turns, ending with a result.
_Avoid_: Game (when referring to a particular contest)

**Turn**:
One numbered cycle in which both players plan and commit their plays before those plays are revealed.
_Avoid_: Round

**Phase**:
The match's status, either planning, when players may stage and commit plays, or ended, when the result is final.

**Energy**:
Each player's budget for the combined cost of their staged cards in a turn, starting at one and increasing by one each new turn.
_Avoid_: Remaining energy (when referring to the full turn budget)

## Lanes

**Lane**:
One of three shared board positions, each with room for up to four revealed cards per player.

**Lane total**:
The sum of the power of one player's revealed cards in a lane.
_Avoid_: Total power (when referring to a single lane)

**Location**:
An empty slot displayed in each lane, with no implemented effect.
_Avoid_: Lane (when referring to the slot)

## Cards

**Card**:
An individually identified playable item with a name, cost and power.
_Avoid_: Figure (when referring to a particular playable card)

**CardDefinition**:
The engine's representation of a card's identity, name, cost and power, used for cards in a match as well as authored roster entries.
_Avoid_: Template (when implying a separate runtime card type)

**Hand**:
The player's private collection of cards available to stage for play.

**Deck**:
The player's ordered supply of cards still available to draw into their hand.
_Avoid_: Roster

**Roster**:
The authored collection of cards and their mythological figure, tradition and flavor text from which starter decks are made.
_Avoid_: Deck

**Power**:
A card's contribution to its player's lane total once revealed.
_Avoid_: Cost

**Cost**:
The amount of the turn's energy budget a card requires when included in staged plays.
_Avoid_: Power

## Plays and events

**Play**:
A choice of a card from the player's hand and the lane where it is to be revealed.
_Avoid_: Card (when referring to the choice of card and lane)

**Stage**:
To replace the player's pending plays for the current turn with a legal set of card and lane choices before committing.
_Avoid_: Reveal, commit

**Commit**:
To lock the player's staged plays for the current turn, including an empty set, so that both players committing triggers resolution.
_Avoid_: Stage

**Reveal**:
To place a staged card into its chosen lane as a public card during turn resolution.
_Avoid_: Stage

**MatchEvent**:
A report of a card being revealed, a turn ending or a match ending.
