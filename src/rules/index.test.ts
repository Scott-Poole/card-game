import { expect, test } from "vitest";
import { legalPlays } from "./index.ts";

test("move generation excludes spent energy, full lanes and already staged cards", () => {
  const view = {
    phase: "planning",
    energy: 3,
    own: {
      committed: false,
      hand: [
        { id: "staged", cost: 2 },
        { id: "cheap", cost: 1 },
        { id: "expensive", cost: 2 },
      ],
      staged: [{ cardId: "staged", lane: 1 }],
      lanes: [[{}, {}, {}, {}], [{}, {}, {}], []],
    },
  } as const;
  expect(legalPlays(view)).toEqual([{ cardId: "cheap", lane: 2 }]);
  expect(
    legalPlays({ ...view, own: { ...view.own, committed: true } }),
  ).toEqual([]);
  expect(legalPlays({ ...view, phase: "ended" })).toEqual([]);
});
