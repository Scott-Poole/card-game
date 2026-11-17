import type { Card, PlayerView, Score } from "../../protocol/messages.ts";

export const herald: Card = {
  id: "herald",
  name: "Hermes, Boundary Herald",
  cost: 1,
  power: 2,
};
export const guardian: Card = {
  id: "guardian",
  name: "Athena, Bronze Sentinel",
  cost: 2,
  power: 4,
};
export const voyager: Card = {
  id: "voyager",
  name: "Janus, Threshold Keeper",
  cost: 3,
  power: 3,
};
export const smith: Card = {
  id: "smith",
  name: "Vulcan, Ember Shaper",
  cost: 4,
  power: 5,
};

const opponentVoyager: Card = { ...voyager, id: "opponent-voyager" };
const opponentSmith: Card = { ...smith, id: "opponent-smith" };

export const opening: PlayerView = {
  player: 0,
  phase: "planning",
  result: null,
  turn: 1,
  energy: 1,
  own: {
    hand: [herald, guardian, voyager, smith],
    staged: [],
    deckSize: 8,
    committed: false,
    lanes: [[], [], []],
  },
  opponent: { handSize: 4, deckSize: 8, committed: false, lanes: [[], [], []] },
  events: [],
};
export const staging: PlayerView = {
  ...opening,
  turn: 3,
  energy: 3,
  own: {
    ...opening.own,
    hand: [guardian, voyager, smith],
    deckSize: 6,
    lanes: [[herald], [], []],
    staged: [{ cardId: guardian.id, lane: 1 }],
  },
  opponent: {
    ...opening.opponent,
    deckSize: 6,
    lanes: [[], [opponentVoyager], []],
  },
};
export const revealed: PlayerView = {
  ...staging,
  turn: 4,
  energy: 4,
  own: {
    ...staging.own,
    hand: [voyager, smith],
    staged: [],
    lanes: [[herald], [guardian], []],
  },
  opponent: {
    ...staging.opponent,
    lanes: [[opponentSmith], [opponentVoyager], []],
  },
  events: [
    { type: "card-revealed", player: 0, lane: 1, card: guardian },
    { type: "card-revealed", player: 1, lane: 0, card: opponentSmith },
    { type: "turn-ended", turn: 3 },
  ],
};
const result: Score = { lanes: [1, 0, null], power: [6, 8], winner: 1 };
export const ended: PlayerView = {
  ...revealed,
  phase: "ended",
  result,
  turn: 6,
  energy: 6,
  own: { ...revealed.own, committed: true },
  opponent: { ...revealed.opponent, committed: true },
  events: [
    { type: "turn-ended", turn: 6 },
    { type: "match-ended", result },
  ],
};
export const full: PlayerView = {
  ...revealed,
  own: {
    ...revealed.own,
    hand: [],
    lanes: [[herald, guardian, voyager, smith], [], []],
  },
  opponent: {
    ...revealed.opponent,
    lanes: [
      [herald, guardian, voyager, smith].map((card) => ({
        ...card,
        id: "opponent-" + card.id,
      })),
      [],
      [],
    ],
  },
};

export const tied: PlayerView = {
  ...opening,
  turn: 2,
  energy: 2,
  own: {
    ...opening.own,
    hand: [guardian, voyager, smith],
    lanes: [[herald], [], []],
  },
  opponent: {
    ...opening.opponent,
    lanes: [[{ ...herald, id: "opponent-herald" }], [], []],
  },
};
