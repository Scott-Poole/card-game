import { expect, test } from "vitest";
import { TURN_LIMIT } from "../rules/index.ts";
import {
  selectActionLocked,
  selectCommitLabel,
  selectEnded,
  selectSpentEnergy,
  selectStanding,
} from "./boardFacts.ts";

const none = { effect: { kind: "none" } } as const;
const lane = (...powers: number[]) => powers.map((power) => ({ power }));

function planning(overrides: { turn?: number; committed?: boolean } = {}) {
  return {
    phase: "planning" as const,
    turn: overrides.turn ?? 3,
    own: { committed: overrides.committed ?? false },
  };
}
const ended = { phase: "ended" as const, turn: 6, own: { committed: true } };

test("commit label is empty without a view", () => {
  expect(selectCommitLabel(null, false)).toBe("");
});

test("commit label offers View result once the match has ended", () => {
  expect(selectCommitLabel(ended, false)).toBe("View result");
});

test("commit label says Revealing while a reveal plays, even for an ended match", () => {
  expect(selectCommitLabel(planning(), true)).toBe("Revealing…");
  expect(selectCommitLabel(ended, true)).toBe("Revealing…");
});

test("commit label waits for the opponent once committed", () => {
  expect(selectCommitLabel(planning({ committed: true }), false)).toBe(
    "Waiting for opponent…",
  );
});

test("commit label counts the turn while planning", () => {
  expect(selectCommitLabel(planning({ turn: 2 }), false)).toBe(
    `End turn 2/${String(TURN_LIMIT)}`,
  );
});

test("ended means the match is over and no reveal is playing", () => {
  expect(selectEnded(null, false)).toBe(false);
  expect(selectEnded(planning(), false)).toBe(false);
  expect(selectEnded(ended, true)).toBe(false);
  expect(selectEnded(ended, false)).toBe(true);
});

const hand = [
  { id: "a", cost: 2 },
  { id: "b", cost: 3 },
];

test("spent energy is zero with nothing staged", () => {
  expect(selectSpentEnergy(hand, [])).toBe(0);
});

test("spent energy sums the cost of each staged card", () => {
  expect(
    selectSpentEnergy(hand, [
      { cardId: "a", lane: 0 },
      { cardId: "b", lane: 2 },
    ]),
  ).toBe(5);
});

test("a staged card missing from the hand costs nothing", () => {
  expect(
    selectSpentEnergy(hand, [
      { cardId: "a", lane: 0 },
      { cardId: "ghost", lane: 1 },
    ]),
  ).toBe(2);
});

test("spent energy is zero when there is no hand", () => {
  expect(selectSpentEnergy([], [{ cardId: "a", lane: 0 }])).toBe(0);
});

function standingView(
  own: number[][],
  opponent: number[][],
  phase: "planning" | "ended" = "planning",
) {
  return {
    phase,
    own: { lanes: own.map((powers) => lane(...powers)) },
    opponent: { lanes: opponent.map((powers) => lane(...powers)) },
    locations: own.map(() => none),
  };
}

test("standing counts the lanes the player leads", () => {
  const view = standingView([[5], [1], [2]], [[1], [0], [1]]);
  expect(selectStanding(view, false)).toEqual({
    headline: "Current standing: leading in 3 of 3 lanes",
    leading: 3,
  });
});

test("a tied lane is not led", () => {
  const view = standingView([[2], [3], []], [[2], [1], []]);
  expect(selectStanding(view, false).leading).toBe(1);
  expect(selectStanding(view, false).headline).toBe(
    "Current standing: leading in 1 of 3 lanes",
  );
});

test("a deficit leads no lanes", () => {
  const view = standingView([[1], [], [2]], [[4], [1], [2]]);
  expect(selectStanding(view, false)).toEqual({
    headline: "Current standing: leading in 0 of 3 lanes",
    leading: 0,
  });
});

test("an ended board calls the standing the final board", () => {
  const view = standingView([[3], [], []], [[1], [], []], "ended");
  expect(selectStanding(view, false).headline).toBe(
    "Final board: leading in 1 of 3 lanes",
  );
});

test("an ended board still reads as current standing while the last reveal plays", () => {
  const view = standingView([[3], [], []], [[1], [], []], "ended");
  expect(selectStanding(view, true).headline).toBe(
    "Current standing: leading in 1 of 3 lanes",
  );
});

const open = {
  revealing: false,
  pending: null,
  status: "connected" as const,
  view: { phase: "planning" as const, own: { committed: false } },
};

test("actions are open while planning, connected and idle", () => {
  expect(selectActionLocked(open)).toBe(false);
});

test("actions lock while a reveal plays", () => {
  expect(selectActionLocked({ ...open, revealing: true })).toBe(true);
});

test("actions lock while a request is pending", () => {
  expect(
    selectActionLocked({
      ...open,
      pending: { message: { type: "commit" }, turn: 3 },
    }),
  ).toBe(true);
});

test.each(["connecting", "error"] as const)(
  "actions lock while the connection is %s",
  (status) => {
    expect(selectActionLocked({ ...open, status })).toBe(true);
  },
);

test("actions lock once the player has committed", () => {
  expect(
    selectActionLocked({
      ...open,
      view: { phase: "planning", own: { committed: true } },
    }),
  ).toBe(true);
});

test("actions lock once the match has ended", () => {
  expect(
    selectActionLocked({
      ...open,
      view: { phase: "ended", own: { committed: false } },
    }),
  ).toBe(true);
});

test("actions are not locked by a missing view alone", () => {
  expect(selectActionLocked({ ...open, view: null })).toBe(false);
});
