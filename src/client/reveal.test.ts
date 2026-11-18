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
  expect(sequenceReveal(opening, [])).toEqual([]);
});

test("single reveal updates only its lane and running total", () => {
  const steps = sequenceReveal(opening, [
    { type: "card-revealed", player: 0, lane: 2, card: herald },
  ]);
  expect(steps[0]?.view.own.lanes).toEqual([[], [], [herald]]);
  expect(steps[0] && selectLaneTotals(steps[0].view)).toEqual({
    own: [0, 0, 2],
    opponent: [0, 0, 0],
  });
  expect(opening.own.lanes).toEqual([[], [], []]);
});

test("both players reveal in event order and all steps equal authoritative lanes", () => {
  const steps = sequenceReveal(staging, revealed.events);
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

test("match ending follows the turn and preserves final lanes", () => {
  const steps = sequenceReveal(revealed, ended.events);
  expect(steps.map((step) => step.event.type)).toEqual([
    "turn-ended",
    "match-ended",
  ]);
  expect(steps.at(-1)?.view.phase).toBe("ended");
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
  const steps = sequenceReveal(previous, events);
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
