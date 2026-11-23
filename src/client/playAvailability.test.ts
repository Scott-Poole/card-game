import { expect, test } from "vitest";
import { opening } from "./stories/fixtures.ts";
import { playAvailability } from "./playAvailability.ts";

const input = {
  view: opening,
  staged: [],
  revealing: false,
  pending: null,
  status: "connected",
  settling: false,
} as const;

test("only affordable, unstaged cards are available", () => {
  const facts = playAvailability(input);
  expect(facts.available).toEqual(
    [0, 1, 2].map((lane) => ({ cardId: "herald", lane })),
  );
  expect(facts.canStage("herald", 0)).toBe(true);
  expect(facts.canStage("guardian", 0)).toBe(false);
});

test("revealing and pending requests prevent even a finishing drop", () => {
  for (const flags of [
    { revealing: true },
    { pending: { message: { type: "commit" as const }, turn: 1 } },
  ]) {
    const facts = playAvailability({ ...input, ...flags, settling: true });
    expect(facts.locked).toBe(true);
    expect(facts.canStage("herald", 0, true)).toBe(false);
  }
});

test("settling permits only the finishing drop and still checks legality", () => {
  const facts = playAvailability({ ...input, settling: true });
  expect(facts.locked).toBe(true);
  expect(facts.canStage("herald", 0)).toBe(false);
  expect(facts.canStage("herald", 0, true)).toBe(true);
  expect(facts.canStage("guardian", 0, true)).toBe(false);
});

test("staged cards consume energy and lane capacity; pending retains the full reason", () => {
  const view = {
    ...opening,
    energy: 3,
    locations: [
      {
        ...{ id: "small", name: "Small", text: "" },
        effect: { kind: "lane-capacity", limit: 1 } as const,
      },
    ],
  };
  const facts = playAvailability({
    ...input,
    view,
    staged: [{ cardId: "herald", lane: 0 }],
  });
  expect(facts.laneFull(0)).toBe(true);
  expect(facts.canStage("guardian", 0)).toBe(false);
  expect(facts.canStage("guardian", 1)).toBe(true);
  expect(facts.canStage("herald", 1)).toBe(false);
  expect(
    playAvailability({
      ...input,
      view,
      staged: [{ cardId: "herald", lane: 0 }],
      pending: { message: { type: "commit" }, turn: 1 },
    }).laneFull(0),
  ).toBe(true);
  expect(
    playAvailability({
      ...input,
      view,
      staged: [{ cardId: "herald", lane: 0 }],
      revealing: true,
    }).laneFull(0),
  ).toBe(false);
});

test("missing views, disconnected, committed and ended matches offer no staging", () => {
  expect(playAvailability({ ...input, view: null }).available).toEqual([]);
  for (const flags of [
    { status: "error" as const },
    { view: { ...opening, own: { ...opening.own, committed: true } } },
  ]) {
    expect(
      playAvailability({ ...input, ...flags }).canStage("herald", 0, true),
    ).toBe(false);
  }
});
