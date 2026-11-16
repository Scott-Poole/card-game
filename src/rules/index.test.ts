import { expect, test } from "vitest";
import { checkStaging, legalPlays } from "./index.ts";

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

test("replacement staging preserves established errors and precedence", () => {
  const view = {
    phase: "planning",
    energy: 1,
    own: {
      committed: false,
      hand: [
        { id: "cheap", cost: 1 },
        { id: "costly", cost: 2 },
      ],
      staged: [{ cardId: "cheap", lane: 0 }],
      lanes: [[], [{}, {}, {}, {}], []],
    },
  } as const;
  const cheap = { cardId: "cheap", lane: 0 };
  for (const [plays, error] of [
    [[{ cardId: "missing", lane: 0 }], "card-not-in-hand"],
    [[cheap, cheap], "duplicate-card"],
    [[{ cardId: "costly", lane: 0 }], "overspend"],
    [[{ cardId: "costly", lane: 1 }], "full-lane"],
    [[{ cardId: "missing", lane: -1 }], "unknown-lane"],
    [[{ cardId: "cheap", lane: NaN }], "unknown-lane"],
    [[{ cardId: "cheap", lane: 1.5 }], "unknown-lane"],
  ] as const) {
    expect(checkStaging(view, plays)).toEqual({ ok: false, error });
  }
  expect(checkStaging(view, [cheap])).toEqual({ ok: true });
  expect(
    checkStaging({ ...view, own: { ...view.own, committed: true } }, []),
  ).toEqual({ ok: false, error: "already-committed" });
  expect(
    checkStaging(
      { ...view, phase: "ended", own: { ...view.own, committed: true } },
      [],
    ),
  ).toEqual({ ok: false, error: "wrong-phase" });
});
