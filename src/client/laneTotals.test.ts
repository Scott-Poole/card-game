import { expect, test } from "vitest";
import { selectLaneTotals } from "./laneTotals.ts";

test("empty lanes have zero totals", () => {
  expect(
    selectLaneTotals({
      own: { lanes: [[], [], []] },
      opponent: { lanes: [[], [], []] },
    }),
  ).toEqual({ own: [0, 0, 0], opponent: [0, 0, 0] });
});

test("partial and full revealed lanes count both sides, excluding staged cards", () => {
  const view = {
    own: {
      lanes: [
        [{ power: 3 }],
        [],
        [{ power: 1 }, { power: 2 }, { power: 4 }, { power: 5 }],
      ],
      hand: [{ power: 99 }],
      staged: [{ cardId: "hidden", lane: 1 }],
    },
    opponent: {
      lanes: [[], [{ power: 7 }, { power: 2 }], []],
      committed: true,
      handSize: 4,
    },
  };
  expect(selectLaneTotals(view)).toEqual({
    own: [3, 0, 12],
    opponent: [0, 9, 0],
  });
});
