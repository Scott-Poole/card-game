import { expect, test } from "vitest";
import type { PlayerView, Score } from "../protocol/messages.ts";
import { ended } from "./stories/fixtures.ts";
import { summarizeResult } from "./matchResult.ts";

type EndedView = Extract<PlayerView, { phase: "ended" }>;

function endedFor(
  player: 0 | 1,
  result: Score,
  events: PlayerView["events"] = [
    { type: "turn-ended", turn: 6 },
    { type: "match-ended", result },
  ],
): EndedView {
  return { ...ended, phase: "ended", player, result, events };
}

const mixed: Score = { lanes: [1, 0, null], power: [6, 8], winner: 1 };

test("a win reads as the viewer's win, with their lanes and power first", () => {
  const summary = summarizeResult(
    endedFor(0, { lanes: [0, 0, 1], power: [9, 4], winner: 0 }),
  );
  expect(summary).toEqual({
    winner: "win",
    lanes: ["win", "win", "loss"],
    lanesWon: { own: 2, opponent: 1 },
    power: { own: 9, opponent: 4 },
    forfeited: false,
  });
});

test("a loss reads as the viewer's loss", () => {
  const summary = summarizeResult(
    endedFor(0, { lanes: [1, 1, 0], power: [3, 8], winner: 1 }),
  );
  expect(summary.winner).toBe("loss");
  expect(summary.lanes).toEqual(["loss", "loss", "win"]);
  expect(summary.lanesWon).toEqual({ own: 1, opponent: 2 });
});

test("a draw has no winner and counts no lane for either side", () => {
  const summary = summarizeResult(
    endedFor(1, { lanes: [null, null, null], power: [5, 5], winner: null }),
  );
  expect(summary).toEqual({
    winner: "draw",
    lanes: ["draw", "draw", "draw"],
    lanesWon: { own: 0, opponent: 0 },
    power: { own: 5, opponent: 5 },
    forfeited: false,
  });
});

test("a mixed-lane board reports a win, a loss and a draw lane in order", () => {
  const summary = summarizeResult(endedFor(0, mixed));
  expect(summary.lanes).toEqual(["loss", "win", "draw"]);
  expect(summary.lanesWon).toEqual({ own: 1, opponent: 1 });
});

test("power and lanes are read from the viewer's side for player 0 and 1", () => {
  const asFirst = summarizeResult(endedFor(0, mixed));
  const asSecond = summarizeResult(endedFor(1, mixed));
  expect(asFirst.power).toEqual({ own: 6, opponent: 8 });
  expect(asSecond.power).toEqual({ own: 8, opponent: 6 });
  expect(asFirst.winner).toBe("loss");
  expect(asSecond.winner).toBe("win");
  expect(asFirst.lanes).toEqual(["loss", "win", "draw"]);
  expect(asSecond.lanes).toEqual(["win", "loss", "draw"]);
  expect(asSecond.lanesWon).toEqual({ own: 1, opponent: 1 });
});

test("a lone match-ended event is a forfeit; a normal ending is not", () => {
  const result: Score = { lanes: [0, 0, 0], power: [0, 0], winner: 0 };
  expect(
    summarizeResult(endedFor(0, result, [{ type: "match-ended", result }]))
      .forfeited,
  ).toBe(true);
  expect(summarizeResult(endedFor(0, result)).forfeited).toBe(false);
  expect(summarizeResult(endedFor(0, result, [])).forfeited).toBe(false);
});
