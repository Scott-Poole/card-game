import { expect, test } from "vitest";
import { placeholderRoster } from "./placeholder-roster.ts";
test("placeholder roster has twelve distinct vanilla figures spanning costs one to six", () => {
  expect(placeholderRoster.length).toBeGreaterThanOrEqual(12);
  expect(new Set(placeholderRoster.map((c) => c.id)).size).toBe(
    placeholderRoster.length,
  );
  expect(new Set(placeholderRoster.map((c) => c.name)).size).toBe(
    placeholderRoster.length,
  );
  for (const card of placeholderRoster) {
    expect(card.cost).toBeGreaterThanOrEqual(1);
    expect(card.cost).toBeLessThanOrEqual(6);
  }
});
