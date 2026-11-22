import { expect, test } from "vitest";
import { inspectionFacts } from "./inspection.ts";

test("card facts retain the fallback text without a view", () => {
  expect(
    inspectionFacts(
      { kind: "card", card: { id: "a", name: "Athena", cost: 2, power: 3 } },
      null,
      null,
      false,
      [],
    ),
  ).toEqual({
    kind: "card",
    name: "Athena",
    stats: "Cost 2 · Power 3",
    ability: "No ability description available.",
    showLaneHint: false,
  });
});

import { opening } from "./stories/fixtures.ts";
import type { Card } from "../protocol/messages.ts";
const card: Card = {
  id: "a",
  name: "Athena",
  cost: 2,
  power: 3,
  ability: { text: "Gain power.", effect: { kind: "boost-self", amount: 1 } },
};

test.each([
  {
    selected: "a",
    locked: false,
    available: [{ cardId: "a", lane: 0 }],
    hint: true,
  },
  {
    selected: null,
    locked: false,
    available: [{ cardId: "a", lane: 0 }],
    hint: false,
  },
  {
    selected: "a",
    locked: true,
    available: [{ cardId: "a", lane: 0 }],
    hint: false,
  },
  {
    selected: "a",
    locked: false,
    available: [{ cardId: "b", lane: 0 }],
    hint: false,
  },
])("card hint: %j", ({ selected, locked, available, hint }) => {
  expect(
    inspectionFacts(
      { kind: "card", card },
      opening,
      selected,
      locked,
      available,
    ),
  ).toEqual({
    kind: "card",
    name: "Athena",
    stats: "Cost 2 · Power 3",
    ability: "Gain power.",
    showLaneHint: hint,
  });
});

test.each([
  {
    view: opening,
    number: 1,
    name: opening.locations[0]?.name,
    text: opening.locations[0]?.text,
  },
  { view: opening, number: 4, name: "Lane 4", text: "No location effect." },
  { view: null, number: 1, name: "Lane 1", text: "No location effect." },
])("lane facts: %j", ({ view, number, name, text }) => {
  expect(
    inspectionFacts({ kind: "lane", number }, view, null, false, []),
  ).toEqual({ kind: "lane", name, label: `Lane ${String(number)}`, text });
});

test.each([
  { side: "own", view: opening, name: "You · Player 1" },
  { side: "opponent", view: opening, name: "Opponent · Player 2" },
  { side: "own", view: { ...opening, player: 1 }, name: "You · Player 2" },
  {
    side: "opponent",
    view: { ...opening, player: 1 },
    name: "Opponent · Player 1",
  },
  { side: "own", view: null, name: "You · Player 1" },
  { side: "opponent", view: null, name: "Opponent · Player 1" },
] satisfies {
  side: "own" | "opponent";
  view: typeof opening | null;
  name: string;
}[])("player facts: %j", ({ side, view, name }) => {
  expect(
    inspectionFacts({ kind: "player", side }, view, null, false, []),
  ).toEqual({ kind: "player", side, name });
});
