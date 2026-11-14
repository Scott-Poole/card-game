import { expect, test } from "vitest";
import { type RosterEntry, validateRoster } from "./roster.ts";

test("reports missing cost coverage without throwing", () => {
  expect(validateRoster([])).toEqual(
    [1, 2, 3, 4, 5, 6].map((cost) => ({ code: "cost-coverage", cost })),
  );
});

const valid = Array.from(
  { length: 12 },
  (_, index) =>
    ({
      card: {
        id: `figure-${String(index)}`,
        name: `Figure ${String(index)}`,
        cost: Math.floor(index / 2) + 1,
        power: Math.floor(index / 2) + 1,
      },
      figure: "Hermes",
      tradition: "greek",
      flavor: "A road remembers every footstep.",
    }) satisfies RosterEntry,
);

const first = valid[0];
if (!first) throw new Error("Missing fixture");

test.each([
  ["id", { card: { ...first.card, id: "Bad_id" } }],
  ["duplicate-id", { card: { ...first.card, id: "figure-1" } }],
  ["duplicate-name", { card: { ...first.card, name: "fIGURE 1" } }],
  ["cost", { card: { ...first.card, cost: 1.5 } }],
  ["power", { card: { ...first.card, power: 4 } }],
  ["cost", { card: { ...first.card, cost: 0 } }],
  ["cost", { card: { ...first.card, cost: 7 } }],
  ["cost", { card: { ...first.card, cost: NaN } }],
  ["power", { card: { ...first.card, power: 0 } }],
  ["power", { card: { ...first.card, power: 1.5 } }],
  ["power", { card: { ...first.card, power: Infinity } }],
  ["tradition", { tradition: "norse" }],
  ["flavor", { flavor: "x".repeat(121) }],
  ["flavor", { flavor: "   " }],
  ["figure", { figure: "   " }],
  ["flavor", { flavor: "" }],
])("rejects %s and accepts the valid counterpart", (code, patch) => {
  expect(validateRoster(valid)).toEqual([]);
  expect(
    validateRoster([{ ...first, ...patch }, ...valid.slice(1)]),
  ).toContainEqual({ code, index: 0 });
});

test.each(["greek", "roman"])(
  "accepts %s and inclusive bounds",
  (tradition) => {
    const entries = valid.map((entry, index) => ({
      ...entry,
      tradition,
      flavor: index % 2 ? "x".repeat(120) : "x",
      card: {
        ...entry.card,
        power: index % 2 ? 3 * entry.card.cost : entry.card.cost,
      },
    }));
    expect(validateRoster(entries)).toEqual([]);
  },
);

test.each([1, 2, 3, 4, 5, 6])("requires two cards at cost %i", (cost) => {
  expect(validateRoster(valid)).toEqual([]);
  const index = valid.findIndex((entry) => entry.card.cost === cost);
  expect(validateRoster(valid.filter((_, i) => i !== index))).toEqual([
    { code: "cost-coverage", cost },
  ]);
});

test("accepts more than two cards at a cost", () => {
  expect(
    validateRoster([
      ...valid,
      {
        ...first,
        card: { ...first.card, id: "extra-card", name: "Extra figure" },
      },
    ]),
  ).toEqual([]);
});
