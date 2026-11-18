import { expect, test } from "vitest";
import {
  commit,
  createMatch,
  playerView,
  resolve,
  stage,
  type CardDefinition,
  type MatchState,
  type Result,
} from "../engine/index.ts";
import { TURN_LIMIT, type LocationEffect } from "../rules/index.ts";
import { selectLaneTotals } from "./laneTotals.ts";

const withEffect = (effect: LocationEffect) => ({ effect });
const noEffects = [
  withEffect({ kind: "none" }),
  withEffect({ kind: "none" }),
  withEffect({ kind: "none" }),
];

test("empty lanes have zero totals", () => {
  expect(
    selectLaneTotals({
      own: { lanes: [[], [], []] },
      opponent: { lanes: [[], [], []] },
      locations: noEffects,
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
    locations: noEffects,
  };
  expect(selectLaneTotals(view)).toEqual({
    own: [3, 0, 12],
    opponent: [0, 9, 0],
  });
});

test("each lane's location effect changes its totals", () => {
  expect(
    selectLaneTotals({
      own: { lanes: [[{ power: 3 }], [{ power: 3 }], [{ power: 3 }]] },
      opponent: {
        lanes: [[{ power: 1 }, { power: 1 }], [{ power: 1 }, { power: 1 }], []],
      },
      locations: [
        withEffect({ kind: "none" }),
        withEffect({ kind: "power-per-card", amount: 1 }),
        withEffect({ kind: "power-per-card", amount: 2 }),
      ],
    }),
  ).toEqual({ own: [3, 4, 5], opponent: [2, 4, 0] });
});

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

test("running totals equal the engine's lane totals for the same view", () => {
  const deck = (power: number): CardDefinition[] =>
    Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `Figure ${String(i)}`,
      cost: 0,
      power,
    }));
  const pool = Array.from({ length: 6 }, (_, i) => ({
    id: `place-${String(i)}`,
    name: `Place ${String(i)}`,
    text: "Each card here adds 2 power.",
    effect: { kind: "power-per-card", amount: 2 } as const,
  }));
  let state: MatchState = createMatch(11, [deck(3), deck(1)], pool);
  const hands = state.players.map((player) => player.hand);
  const plays = (hand: readonly CardDefinition[], lanes: readonly number[]) =>
    hand.flatMap((card, i) => {
      const lane = lanes[i];
      return lane === undefined ? [] : [{ cardId: card.id, lane }];
    });
  state = unwrap(stage(state, 0, plays(hands[0] ?? [], [0, 0, 2])));
  state = unwrap(stage(state, 1, plays(hands[1] ?? [], [0, 1])));
  state = unwrap(commit(state, 0));
  state = unwrap(commit(state, 1));
  state = unwrap(resolve(state)).state;
  for (let turn = 2; turn <= TURN_LIMIT; turn++) {
    state = unwrap(stage(state, 0, []));
    state = unwrap(stage(state, 1, []));
    state = unwrap(commit(state, 0));
    state = unwrap(commit(state, 1));
    state = unwrap(resolve(state)).state;
  }
  const result = state.result;
  if (!result) throw new Error("Match did not end");

  const totals = selectLaneTotals(playerView(state, 0));
  expect(totals.own).toEqual([10, 0, 5]);
  expect(totals.opponent).toEqual([3, 3, 0]);
  expect(result.lanes).toEqual(
    totals.own.map((own, lane) => {
      const opponent = totals.opponent[lane] ?? 0;
      return own === opponent ? null : own > opponent ? 0 : 1;
    }),
  );
  expect(result.power).toEqual([
    totals.own.reduce((sum, n) => sum + n, 0),
    totals.opponent.reduce((sum, n) => sum + n, 0),
  ]);
});
