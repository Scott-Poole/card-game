import type { PlayerView, MatchEvent } from "../protocol/messages.ts";
import { selectLaneTotals } from "./laneTotals.ts";
import { expect, test } from "vitest";
import { sequenceReveal } from "./reveal.ts";
import {
  opening,
  staging,
  revealed,
  ended,
  herald,
} from "./stories/fixtures.ts";

test("zero events leaves no steps", () => {
  expect(sequenceReveal(opening, [], opening)).toEqual([]);
});

test("single reveal updates only its lane and running total", () => {
  const steps = sequenceReveal(
    opening,
    [{ type: "card-revealed", player: 0, lane: 2, card: herald }],
    opening,
  );
  expect(steps[0]?.view.own.lanes).toEqual([[], [], [herald]]);
  expect(steps[0] && selectLaneTotals(steps[0].view)).toEqual({
    own: [0, 0, 2],
    opponent: [0, 0, 0],
  });
  expect(opening.own.lanes).toEqual([[], [], []]);
});

test("both players reveal in event order and all steps equal authoritative lanes", () => {
  const steps = sequenceReveal(staging, revealed.events, staging);
  expect(steps.map((step) => step.event.type)).toEqual([
    "card-revealed",
    "card-revealed",
    "turn-ended",
  ]);
  expect(steps[0] && selectLaneTotals(steps[0].view)).toEqual({
    own: [2, 4, 0],
    opponent: [0, 3, 0],
  });
  expect(steps.at(-1)?.view.own.lanes).toEqual(revealed.own.lanes);
  expect(steps.at(-1)?.view.opponent.lanes).toEqual(revealed.opponent.lanes);
});

test("an opponent-first event order maps each reveal to its own side", () => {
  const [mine, theirs] = revealed.events;
  if (mine?.type !== "card-revealed" || theirs?.type !== "card-revealed")
    throw new Error("Expected two reveals");
  const steps = sequenceReveal(
    staging,
    [theirs, mine, { type: "turn-ended", turn: 3 }],
    staging,
  );
  expect(
    steps.map((step) =>
      step.event.type === "card-revealed" ? step.event.player : null,
    ),
  ).toEqual([1, 0, null]);
  expect(steps[0] && selectLaneTotals(steps[0].view)).toEqual({
    own: [2, 0, 0],
    opponent: [5, 3, 0],
  });
});

test("match ending follows the turn and preserves final lanes", () => {
  const steps = sequenceReveal(revealed, ended.events, revealed);
  expect(steps.map((step) => step.event.type)).toEqual([
    "turn-ended",
    "match-ended",
  ]);
  expect(steps.at(-1)?.view.phase).toBe("ended");
  expect(steps.at(-1)?.view.revealFirst).toBeNull();
  expect(steps.at(-1)?.view.result).toEqual(ended.result);
  expect(steps.at(-1)?.view.own.lanes).toEqual(ended.own.lanes);
  expect(steps.at(-1)?.view.opponent.lanes).toEqual(ended.opponent.lanes);
});

test("player one's match-ending turn maps both sides to the correct lanes", () => {
  if (ended.phase !== "ended") throw new Error("Expected ended fixture");
  const previous = {
    ...staging,
    player: 1,
  } satisfies PlayerView;
  const events = [
    ...revealed.events,
    { type: "match-ended", result: ended.result },
  ] satisfies MatchEvent[];
  const steps = sequenceReveal(previous, events, previous);
  expect(steps.at(-1)?.view.own.lanes).toEqual([
    [herald, revealed.opponent.lanes[0]?.[0]],
    [],
    [],
  ]);
  expect(steps.at(-1)?.view.opponent.lanes).toEqual([
    [],
    [staging.opponent.lanes[1]?.[0], revealed.own.lanes[1]?.[0]],
    [],
  ]);
  expect(steps.at(-1)?.view.result).toEqual(ended.result);
});

test.each([0, 1] as const)(
  "power change updates side %i and its lane total",
  (player) => {
    const steps = sequenceReveal(
      opening,
      [
        { type: "card-revealed", player, lane: 2, card: herald },
        { type: "power-changed", player, lane: 2, cardId: herald.id, power: 5 },
      ],
      opening,
    );
    const final = steps[1]?.view;
    expect(final && selectLaneTotals(final)).toEqual(
      player === 0
        ? { own: [0, 0, 5], opponent: [0, 0, 0] }
        : { own: [0, 0, 0], opponent: [0, 0, 5] },
    );
    expect(
      steps[0]?.view[player === 0 ? "own" : "opponent"].lanes[2]?.[0]?.power,
    ).toBe(2);
  },
);

test.each([0, 1] as const)(
  "destroy moves printed card into side %i zone",
  (player) => {
    const side = player === 0 ? "own" : "opponent";
    const final = {
      ...opening,
      [side]: {
        ...opening[side],
        zones: { ...opening[side].zones, destroyed: [herald] },
      },
    };
    const steps = sequenceReveal(
      opening,
      [
        { type: "card-revealed", player, lane: 2, card: herald },
        { type: "power-changed", player, lane: 2, cardId: herald.id, power: 9 },
        { type: "card-destroyed", player, lane: 2, cardId: herald.id },
      ],
      final,
    );
    expect(steps.at(-1)?.view[side].lanes[2]).toEqual([]);
    expect(steps.at(-1)?.view[side].zones.destroyed).toEqual([herald]);
  },
);

test("cross-turn destruction uses the authoritative printed definition and owner", () => {
  const previous: PlayerView = {
    ...opening,
    opponent: {
      ...opening.opponent,
      lanes: [[], [], [{ ...herald, power: 9 }]],
    },
  };
  const final: PlayerView = {
    ...opening,
    opponent: {
      ...opening.opponent,
      zones: { ...opening.opponent.zones, destroyed: [herald] },
    },
  };
  const steps = sequenceReveal(
    previous,
    [{ type: "card-destroyed", player: 1, lane: 2, cardId: herald.id }],
    final,
  );
  expect(steps[0]?.view.opponent.zones.destroyed).toEqual([herald]);
  expect(steps[0]?.view.opponent.lanes[2]).toEqual([]);
});

test("destruction refuses a missing authoritative printed card", () => {
  expect(() =>
    sequenceReveal(
      opening,
      [{ type: "card-destroyed", player: 0, lane: 0, cardId: "missing" }],
      opening,
    ),
  ).toThrow("Destroyed card missing from final view");
});
