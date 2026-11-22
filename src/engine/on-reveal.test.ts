import { expect, it } from "vitest";
import { createMatch } from "./index.ts";
import { testLocations } from "./locations.test-support.ts";
import { resolveOnReveal } from "./on-reveal.ts";

it("boosts the revealing card and reports its new power without mutating input", () => {
  const card = { id: "a", name: "A", cost: 1, power: 2 };
  const state = createMatch(1, [[], []], testLocations);
  const input = {
    ...state,
    players: [
      { ...state.players[0], lanes: [[{ ...card, printed: card }], [], []] },
      state.players[1],
    ],
  } satisfies typeof state;
  const result = resolveOnReveal(
    input,
    0,
    0,
    {
      kind: "boost-self",
      amount: 2,
    },
    input.players[0].lanes[0]?.at(-1)?.id ?? "revealing",
  );
  expect(result.state.players[0].lanes[0]?.[0]?.power).toBe(4);
  expect(result.events).toEqual([
    { type: "power-changed", player: 0, lane: 0, cardId: "a", power: 4 },
  ]);
  expect(input.players[0].lanes[0]?.[0]?.power).toBe(2);
});

function board(own: readonly number[], enemy: readonly number[]) {
  const state = createMatch(17, [[], []], testLocations);
  function cards(powers: readonly number[]) {
    return powers.map((power, index) => {
      const printed = { id: String(index), name: "Card", cost: 1, power: 3 };
      return { ...printed, printed, power };
    });
  }
  return {
    ...state,
    players: [
      { ...state.players[0], lanes: [cards(own), [], []] },
      { ...state.players[1], lanes: [cards(enemy), cards([5]), []] },
    ],
  } satisfies typeof state;
}

it("boosts earlier allies in order and excludes the revealing card", () => {
  const input = board([1, 3, 2], []);
  const result = resolveOnReveal(
    input,
    0,
    0,
    {
      kind: "boost-lane-allies",
      amount: 2,
    },
    input.players[0].lanes[0]?.at(-1)?.id ?? "revealing",
  );
  expect(result.state.players[0].lanes[0]?.map((c) => c.power)).toEqual([
    3, 5, 2,
  ]);
  expect(result.events).toEqual([
    { type: "power-changed", player: 0, lane: 0, cardId: "0", power: 3 },
    { type: "power-changed", player: 0, lane: 0, cardId: "1", power: 5 },
  ]);
  expect(input.players[0].lanes[0]?.map((c) => c.power)).toEqual([1, 3, 2]);
});

it.each([{ own: [] }, { own: [2] }])(
  "boosting with no earlier allies produces no events: %j",
  ({ own }) => {
    const input = board(own, []);
    const result = resolveOnReveal(
      input,
      0,
      0,
      {
        kind: "boost-lane-allies",
        amount: 1,
      },
      input.players[0].lanes[0]?.at(-1)?.id ?? "revealing",
    );
    expect(result.state).toEqual(input);
    expect(result.events).toEqual([]);
  },
);

it("weakens only enemies in the lane, floors at zero, and omits unchanged events", () => {
  const input = board([2], [1, 0, 4]);
  const result = resolveOnReveal(
    input,
    0,
    0,
    {
      kind: "weaken-lane-enemies",
      amount: 2,
    },
    input.players[0].lanes[0]?.at(-1)?.id ?? "revealing",
  );
  expect(result.state.players[1].lanes[0]?.map((c) => c.power)).toEqual([
    0, 0, 2,
  ]);
  expect(result.state.players[1].lanes[1]?.[0]?.power).toBe(5);
  expect(result.events).toEqual([
    { type: "power-changed", player: 1, lane: 0, cardId: "0", power: 0 },
    { type: "power-changed", player: 1, lane: 0, cardId: "2", power: 2 },
  ]);
  expect(input.players[1].lanes[0]?.map((c) => c.power)).toEqual([1, 0, 4]);
  expect(result.state.rng).toBe(input.rng);
});

it("destroys the earliest weakest enemy and stores its printed card", () => {
  const input = board([2], [4, 1, 1]);
  const result = resolveOnReveal(
    input,
    0,
    0,
    {
      kind: "destroy-weakest-enemy",
    },
    input.players[0].lanes[0]?.at(-1)?.id ?? "revealing",
  );
  expect(result.state.players[1].lanes[0]?.map((c) => c.id)).toEqual([
    "0",
    "2",
  ]);
  expect(result.state.players[1].zones.destroyed).toEqual([
    { id: "1", name: "Card", cost: 1, power: 3 },
  ]);
  expect(result.events).toEqual([
    { type: "card-destroyed", player: 1, lane: 0, cardId: "1" },
  ]);
  expect(input.players[1].lanes[0]).toHaveLength(3);
});

it("destroying with no enemy produces no events", () => {
  const input = board([2], []);
  const result = resolveOnReveal(
    input,
    0,
    0,
    {
      kind: "destroy-weakest-enemy",
    },
    input.players[0].lanes[0]?.at(-1)?.id ?? "revealing",
  );
  expect(result.state).toEqual(input);
  expect(result.events).toEqual([]);
});

it("selects the revealing card by identity rather than lane position", () => {
  const input = board([2, 4], []);
  const self = resolveOnReveal(
    input,
    0,
    0,
    { kind: "boost-self", amount: 1 },
    "0",
  );
  expect(self.state.players[0].lanes[0]?.map((c) => c.power)).toEqual([3, 4]);
  const allies = resolveOnReveal(
    input,
    0,
    0,
    { kind: "boost-lane-allies", amount: 1 },
    "0",
  );
  expect(allies.state.players[0].lanes[0]?.map((c) => c.power)).toEqual([2, 5]);
});

it("rejects a self boost when the revealing card is absent", () => {
  expect(() =>
    resolveOnReveal(
      board([], []),
      0,
      0,
      { kind: "boost-self", amount: 1 },
      "missing",
    ),
  ).toThrow("Revealing card must be in its lane");
});
