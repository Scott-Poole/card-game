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

**Resolution**:
The step after both players commit that reveals staged cards, ends the turn and either starts the next turn or ends the match.

**Phase**:
The match's status, either planning, when uncommitted players may stage and commit plays, or ended, when the result is final.

**Energy**:
Each player's budget for the combined cost of their staged cards in a turn, starting at one and increasing by one each new turn.

## Lanes

**Lane**:
One of three shared board positions, each with room for up to four revealed cards per player (fewer where the lane's location is `lane-capacity`).

**Lane total**:
The sum of the power of one player's revealed cards in a lane, plus whatever the lane's location effect adds. Under `power-per-card`, each of that player's revealed cards in the lane adds the effect's `amount` (1 or 2).
_Avoid_: Total power (when referring to a single lane)

**Location**:
A named place with rule text, attached to one lane for the whole match. Each match draws three distinct locations from the authored pool by seed, and both players see them. A location's effect is `none`, `power-per-card` or `lane-capacity`. `power-per-card` changes lane totals, and so lane winners, total power and reveal order. `lane-capacity` caps how many cards each player may reveal in that lane (1 to 3, against the default four): staging past it is refused, and the board shows the extra slots locked.

## Cards

**Card**:
A playable item identified within a player's deck with a name, cost and power.
_Avoid_: Figure (when referring to a particular playable card)

**CardDefinition**:
The engine's representation of a card's identity, name, cost and power, used for cards in a match as well as authored roster entries.

**Hand**:
The player's private collection of cards available to stage for play.

**Deck**:
The player's ordered supply of cards still available to draw into their hand. It starts as two cards per cost, from 1 to 6, drawn from the roster.
_Avoid_: Roster

**Zone**:
One of a player's three off-board piles for cards that have left play: **destroyed** (removed from a lane), **discarded** (sent from hand) and **banished** (removed from the match for good, from anywhere). Every zone is face up: both players' full lists are in each view and can be opened from the player-info sheet at any time. Nothing sends a card to a zone yet: abilities will, and the name "banished" may still change.
_Avoid_: Graveyard, pile (when referring to a particular zone)

**Roster**:
The authored collection of cards and their mythological figure, tradition and flavor text from which decks are drawn.
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

**Reveal order**:
Which player's staged cards are revealed first in a turn, known from the start of planning and shown in each player's view. The player leading the board reveals first: more lanes won, then higher total power. A tied board, including turn 1, is broken by a flip seeded by the match seed, drawn again on each tied turn. It orders only cards that are revealed: a player who stages nothing reveals nothing, first or not. It changes only event order and display; whether it affects ability timing is left to the abilities design.
_Avoid_: Initiative, priority

**Stage**:
To replace the player's pending plays for the current turn with a legal set of card and lane choices before committing.
_Avoid_: Reveal, commit

**Commit**:
To lock the player's staged plays for the current turn, including an empty set, with resolution following once both players have committed.
_Avoid_: Stage

**Reveal**:
To place a staged card into its chosen lane as a public card during turn resolution.
_Avoid_: Stage

**MatchEvent**:
A report of a card being revealed, a turn ending or a match ending.
