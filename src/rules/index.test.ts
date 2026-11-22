import { expect, test } from "vitest";
import {
  isEffect,
  isLocationEffect,
  checkStaging,
  laneCapacity,
  laneIsFull,
  laneTotal,
  laneTotals,
  legalPlays,
  opponentOf,
} from "./index.ts";
import type { LocationEffect } from "./index.ts";

test("move generation excludes spent energy, full lanes and already staged cards", () => {
  const view = {
    phase: "planning",
    energy: 3,
    locations: [{ effect: { kind: "none" } }],
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
    locations: [{ effect: { kind: "none" } }],
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

const cardsOf = (count: number) =>
  [3, 1, 2, 4].slice(0, count).map((power) => ({ power }));
const none: LocationEffect = { kind: "none" };
const perCard = (amount: 1 | 2): LocationEffect => ({
  kind: "power-per-card",
  amount,
});

const capacity = (limit: 1 | 2 | 3): LocationEffect => ({
  kind: "lane-capacity",
  limit,
});

test.each([
  ["none", none, 0, 0],
  ["none", none, 1, 3],
  ["none", none, 4, 10],
  ["power-per-card 1", perCard(1), 0, 0],
  ["power-per-card 1", perCard(1), 1, 4],
  ["power-per-card 1", perCard(1), 4, 14],
  ["power-per-card 2", perCard(2), 0, 0],
  ["power-per-card 2", perCard(2), 1, 5],
  ["power-per-card 2", perCard(2), 4, 18],
  ["lane-capacity 2", capacity(2), 0, 0],
  ["lane-capacity 2", capacity(2), 2, 4],
])(
  "lane total under %s with %i revealed cards is %i",
  (_name, effect, count, total) => {
    expect(laneTotal(cardsOf(count), effect)).toBe(total);
  },
);

test("lane totals apply each lane's own location effect, defaulting to none", () => {
  expect(
    laneTotals(
      [cardsOf(2), cardsOf(2), cardsOf(2)],
      [{ effect: none }, { effect: perCard(1) }, { effect: perCard(2) }],
    ),
  ).toEqual([4, 6, 8]);
  expect(
    laneTotals([cardsOf(2), cardsOf(2)], [{ effect: perCard(2) }]),
  ).toEqual([8, 4]);
});

test("lane capacity is the effect's limit, else the default of four", () => {
  expect(
    [none, capacity(2), capacity(3), perCard(1), undefined].map(laneCapacity),
  ).toEqual([4, 2, 3, 4, 4]);
});

// A limit-2 lane (lane 1) beside an unlimited lane (lane 0); `placed` cards
// are already revealed in the limited lane, `staged` are staged for it.
const limited = (limit: 1 | 2 | 3, placed: number, staged: number) => ({
  phase: "planning" as const,
  energy: 6,
  locations: [{ effect: none }, { effect: capacity(limit) }],
  own: {
    committed: false,
    hand: Array.from({ length: 6 }, (_, i) => ({
      id: `c${String(i)}`,
      cost: 1,
    })),
    staged: Array.from({ length: staged }, (_, i) => ({
      cardId: `c${String(i)}`,
      lane: 1,
    })),
    lanes: [[], Array.from({ length: placed }, () => ({})), []],
  },
});

test.each([
  // [limit, placed, staged, extra card staged, ok]
  [2, 0, 0, true], // limit - 2: room for two
  [2, 0, 1, true], // limit - 1 staged: the second fits
  [2, 0, 2, false], // at the limit: a third is refused
  [2, 1, 0, true], // one revealed counts: limit - 1
  [2, 1, 1, false], // revealed + staged at the limit
  [2, 2, 0, false], // revealed cards alone fill it
  [1, 0, 0, true],
  [1, 1, 0, false],
  [3, 2, 0, true],
  [3, 2, 1, false],
  [3, 3, 0, false],
] as const)(
  "limit-%i lane with %i revealed and %i staged accepts one more: %s",
  (limit, placed, staged, ok) => {
    const view = limited(limit, placed, staged);
    const next = { cardId: `c${String(staged)}`, lane: 1 };
    expect(checkStaging(view, [...view.own.staged, next])).toEqual(
      ok ? { ok: true } : { ok: false, error: "full-lane" },
    );
    expect(laneIsFull(view, 1)).toBe(placed + staged >= limit);
    expect(
      legalPlays(view).some(
        (play) => play.lane === 1 && play.cardId === next.cardId,
      ),
    ).toBe(ok);
  },
);

test("an unlimited lane keeps the default capacity beside a limited one", () => {
  const view = limited(2, 0, 0);
  const four = ["c0", "c1", "c2", "c3"].map((cardId) => ({ cardId, lane: 0 }));
  expect(checkStaging(view, four)).toEqual({ ok: true });
  expect(checkStaging(view, [...four, { cardId: "c4", lane: 0 }])).toEqual({
    ok: false,
    error: "full-lane",
  });
  expect(laneIsFull(view, 0)).toBe(false);
  expect(laneIsFull(view, 1)).toBe(false);
  // Four staged cards fill the unlimited lane, a fifth is refused.
  const filled = { ...view, own: { ...view.own, staged: four } };
  expect(laneIsFull(filled, 0)).toBe(true);
  expect(laneIsFull(filled, 1)).toBe(false);
});

test("opponentOf returns the other player", () => {
  expect(opponentOf(0)).toBe(1);
  expect(opponentOf(1)).toBe(0);
});

for (const { guard, effects } of [
  {
    guard: isEffect,
    effects: [
      { kind: "boost-self", amount: 3 },
      { kind: "boost-lane-allies", amount: 2 },
      { kind: "weaken-lane-enemies", amount: 2 },
      { kind: "destroy-weakest-enemy" },
    ],
  },
  {
    guard: isLocationEffect,
    effects: [
      { kind: "none" },
      { kind: "power-per-card", amount: 2 },
      { kind: "lane-capacity", limit: 3 },
    ],
  },
]) {
  test.each(effects)("checks exact effect shape: $kind", (effect) => {
    expect(guard(effect)).toBe(true);
    expect(guard({ ...effect, extra: true })).toBe(false);
    expect(guard({ ...effect, [Symbol("extra")]: true })).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard({ ...effect, kind: undefined })).toBe(false);
    expect(guard({ ...effect, kind: "unknown" })).toBe(false);
    expect(guard({ ...effect, kind: 1 })).toBe(false);
    expect(guard(Object.assign(Object.create(null), effect))).toBe(true);
    expect(guard(Object.create(effect))).toBe(false);
    class EffectInstance {
      constructor() {
        Object.assign(this, effect);
      }
    }
    expect(guard(new EffectInstance())).toBe(false);
    expect(
      guard(Object.defineProperty({ ...effect }, "extra", { value: true })),
    ).toBe(false);
    const field = "limit" in effect ? "limit" : "amount";
    if (field in effect) {
      expect(guard({ kind: effect.kind })).toBe(false);
      for (const invalid of [0, 4, 1.5, "1", null, undefined, NaN, Infinity]) {
        expect(guard({ ...effect, [field]: invalid })).toBe(false);
      }
      expect(guard({ ...effect, [field]: 1 })).toBe(true);
      if ("amount" in effect && typeof effect.amount === "number") {
        expect(guard({ ...effect, amount: effect.amount + 1 })).toBe(false);
      }
    } else {
      expect(guard({ ...effect, amount: undefined })).toBe(false);
      expect(guard({ ...effect, limit: 1 })).toBe(false);
    }
  });
  test("rejects non-object effects", () => {
    for (const value of [null, undefined, [], "none", 1])
      expect(guard(value)).toBe(false);
  });
}
