import { expect, test } from "vitest";
import { validateRoster } from "../engine/roster.ts";
import { roster, starterDeck } from "./roster.ts";

test("ships twelve valid mythic figures, two per cost and both traditions", () => {
  expect(roster).toHaveLength(12);
  expect(validateRoster(roster)).toEqual([]);
  expect(new Set(roster.map((entry) => entry.tradition))).toEqual(
    new Set(["greek", "roman"]),
  );
  for (const cost of [1, 2, 3, 4, 5, 6])
    expect(roster.filter((entry) => entry.card.cost === cost)).toHaveLength(2);
});

test("starter decks contain only card fields and distinct player instance ids", () => {
  const a = starterDeck(0);
  const b = starterDeck(1);
  expect(a).toHaveLength(12);
  expect(new Set([...a, ...b].map((card) => card.id)).size).toBe(24);
  roster.forEach(({ card }, index) => {
    expect(a[index]).toEqual({ ...card, id: `0:${card.id}` });
    expect(b[index]).toEqual({ ...card, id: `1:${card.id}` });
    expect(Object.keys(a[index] ?? {}).sort()).toEqual([
      "cost",
      "id",
      "name",
      "power",
    ]);
  });
});
