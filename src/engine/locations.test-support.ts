import type { LocationDefinition } from "../rules/index.ts";

/** A small valid pool for engine tests; the shipped pool lives in the server. */
export const testLocations: readonly LocationDefinition[] = Array.from(
  { length: 6 },
  (_, index) => ({
    id: `place-${String(index)}`,
    name: `Place ${String(index)}`,
    text: "No effect for now.",
    effect: { kind: "none" },
  }),
);
