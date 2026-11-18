import { expect, it } from "vitest";
import type { PlayerView } from "../protocol/messages.ts";
import { locations } from "./stories/fixtures.ts";
import { isAcknowledged } from "./isAcknowledged.ts";

const view: PlayerView = {
  phase: "planning",
  result: null,
  turn: 1,
  player: 0,
  energy: 1,
  locations,
  own: {
    hand: [],
    deckSize: 8,
    lanes: [[], [], []],
    staged: [],
    committed: false,
  },
  opponent: { handSize: 4, deckSize: 8, lanes: [[], [], []], committed: false },
  events: [],
};

it("acknowledges when no request is in flight", () => {
  expect(isAcknowledged(null, view)).toBe(true);
});

it("acknowledges a join regardless of turn", () => {
  expect(isAcknowledged({ message: { type: "join" }, turn: 1 }, view)).toBe(
    true,
  );
});

it("acknowledges an ended match even without the requested commit", () => {
  expect(
    isAcknowledged(
      { message: { type: "commit" }, turn: 1 },
      {
        ...view,
        phase: "ended",
        result: { lanes: [null, null, null], power: [0, 0], winner: null },
      },
    ),
  ).toBe(true);
});

it.each([null, 0, 2])("acknowledges a different request turn: %s", (turn) => {
  expect(isAcknowledged({ message: { type: "commit" }, turn }, view)).toBe(
    true,
  );
});

it.each([false, true])(
  "acknowledges commit only when own.committed is %s",
  (committed) => {
    expect(
      isAcknowledged(
        { message: { type: "commit" }, turn: 1 },
        {
          ...view,
          own: { ...view.own, committed },
        },
      ),
    ).toBe(committed);
  },
);

it("acknowledges identical staged plays in order, card and lane", () => {
  expect(
    isAcknowledged(
      {
        message: {
          type: "stage",
          plays: [
            { cardId: "a", lane: 0 },
            { cardId: "b", lane: 1 },
          ],
        },
        turn: 1,
      },
      {
        ...view,
        own: {
          ...view.own,
          staged: [
            { cardId: "a", lane: 0 },
            { cardId: "b", lane: 1 },
          ],
        },
      },
    ),
  ).toBe(true);
});

it.each([
  {
    name: "lane",
    staged: [
      { cardId: "a", lane: 2 },
      { cardId: "b", lane: 1 },
    ],
  },
  {
    name: "order",
    staged: [
      { cardId: "b", lane: 1 },
      { cardId: "a", lane: 0 },
    ],
  },
  {
    name: "card",
    staged: [
      { cardId: "c", lane: 0 },
      { cardId: "b", lane: 1 },
    ],
  },
  { name: "shorter length", staged: [{ cardId: "a", lane: 0 }] },
  {
    name: "longer length",
    staged: [
      { cardId: "a", lane: 0 },
      { cardId: "b", lane: 1 },
      { cardId: "c", lane: 2 },
    ],
  },
])("does not acknowledge stage with different $name", ({ staged }) => {
  expect(
    isAcknowledged(
      {
        message: {
          type: "stage",
          plays: [
            { cardId: "a", lane: 0 },
            { cardId: "b", lane: 1 },
          ],
        },
        turn: 1,
      },
      { ...view, own: { ...view.own, staged } },
    ),
  ).toBe(false);
});

it("acknowledges clearing all staged plays", () => {
  expect(
    isAcknowledged({ message: { type: "stage", plays: [] }, turn: 1 }, view),
  ).toBe(true);
});
