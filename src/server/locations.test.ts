import { expect, test } from "vitest";
import { validateLocations } from "../engine/locations.ts";
import { locations } from "./locations.ts";

test("ships a valid pool of at least six locations", () => {
  expect(validateLocations(locations)).toEqual([]);
});

test("at least two pool locations boost power per card by different amounts", () => {
  const amounts = locations.flatMap(({ effect }) =>
    effect.kind === "power-per-card" ? [effect.amount] : [],
  );
  expect(new Set(amounts).size).toBeGreaterThanOrEqual(2);
});

test("a pool location caps each player at two cards in its lane", () => {
  const capped = locations.filter(
    ({ effect }) => effect.kind === "lane-capacity" && effect.limit === 2,
  );
  expect(capped.length).toBeGreaterThanOrEqual(1);
  for (const { text } of capped) expect(text).toMatch(/\b2\b/);
});
