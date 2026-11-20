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

**Energy**:
Each player's budget for the combined cost of their staged cards in a turn, starting at one and increasing by one each new turn.

**Forfeit**:
An immediate match loss when a player's connection closes during planning: the opponent wins regardless of the board, while the **Result** still describes lane winners and total power from revealed cards. The opponent's final view reports only the match ending, with no turn ending; leaving the queue before being seated or disconnecting after the match has ended is not a forfeit.

**Match**:
A contest between two players over up to six turns, ending with a **Result**, including when a player forfeits.
_Avoid_: Game (when referring to a particular contest)

**Phase**:
The match's status, either planning, when uncommitted players may stage and commit plays, or ended, when the **Result** is final.

**Resolution**:
The step after both players commit that reveals staged cards, ends the turn and either starts the next turn or ends the match.

**Result**:
The outcome, absent until the match ends, recording each lane's winner (none when its lane totals tie), each side's total power across all lanes, and the match winner, with lane totals including location effects. Except for a forfeit, the player who wins more lanes wins the match; equal lanes won are broken by higher total power, and a tie on both is a draw with no winner.

**Turn**:
One numbered cycle in which both players plan and commit their plays before those plays are revealed.
_Avoid_: Round

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
The player's private collection of cards available to stage for play, starting with three cards drawn from their deck. At the start of each later turn, the player draws one more card if their deck is not empty.

**Deck**:
The player's ordered supply of cards still available to draw into their hand. Before the opening hand is drawn, it contains two cards per cost, from 1 to 6, drawn from the roster; it supplies the opening hand and the draws on later turns, with any cards not drawn by the end of the match remaining in the deck.
_Avoid_: Roster

**Zone**:
One of a player's three off-board piles for cards that have left play: **destroyed** (removed from a lane), **discarded** (sent from hand) and **banished** (removed from the match for good, from anywhere). Every zone is face up: both players' full lists are in each view and can be opened from the player-info sheet at any time. Nothing sends a card to a zone yet: abilities will, and the name "banished" may still change.
_Avoid_: Graveyard, pile (when referring to a particular zone)

**Roster**:
The authored collection of cards and their mythological figure, tradition and flavor text from which decks are drawn. At each cost represented, mean power equals twice that cost, with individual cards ranging from their cost to three times their cost, inclusive, so no cost tier is stronger per energy than another.
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
Which player's staged cards are revealed first in a turn, known from the start of planning and shown in each player's view. The player leading the board reveals first: more lanes won, then higher total power. A tied board, including turn 1, is broken by a flip seeded by the match seed, drawn again on each tied turn. It orders only cards that are revealed: a player who stages nothing reveals nothing, first or not. Abilities resolve in reveal order, one card at a time, each straight after its own reveal and before the next card flips. For example, `weaken-lane-enemies` lowers only enemy cards already revealed in its lane: revealing second can answer the leader's cards, while revealing first leaves later enemy reveals untouched.
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
A report of a card being revealed, its power changing, a turn ending or a match ending.

**Ability**:
Optional card rule text and an effect that resolves when the card is revealed.

**Effect**:
A closed rule operation authored as data. Ability effects raise the revealing card’s power (`boost-self`, 1 to 3), raise each other ally already revealed in its lane (`boost-lane-allies`, 1 to 2), or lower each enemy already revealed there (`weaken-lane-enemies`, 1 to 2, floored at 0); location effects apply to lanes.
