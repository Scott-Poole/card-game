import { expect, test } from "vitest";
import { validateLocations } from "../engine/locations.ts";
import { locations } from "./locations.ts";

test("ships a valid pool of at least six locations with no effects yet", () => {
  expect(validateLocations(locations)).toEqual([]);
  for (const location of locations) expect(location.effect.kind).toBe("none");
});
