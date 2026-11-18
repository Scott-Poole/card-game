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
        name: `Figure ${String(index)}, Keeper of Roads`,
        cost: Math.floor(index / 2) + 1,
        power: Math.floor(index / 2) + 1,
      },
      figure: `Figure ${String(index)}`,
      tradition: "greek",
      flavor: "A road remembers every footstep.",
    }) satisfies RosterEntry,
);

const first = valid[0];
if (!first) throw new Error("Missing fixture");

test.each([
  ["id", { card: { ...first.card, id: "Bad_id" } }, [{ code: "id", index: 0 }]],
  [
    "duplicate-id",
    { card: { ...first.card, id: "figure-1" } },
    [
      { code: "duplicate-id", index: 0 },
      { code: "duplicate-id", index: 1 },
    ],
  ],
  [
    "duplicate-name",
    {
      figure: "fIGURE 1",
      card: { ...first.card, name: "fIGURE 1, kEEPER OF rOADS" },
    },
    [
      { code: "duplicate-name", index: 0 },
      { code: "duplicate-name", index: 1 },
    ],
  ],
  [
    "cost",
    { card: { ...first.card, cost: 1.5 } },
    [
      { code: "cost", index: 0 },
      { code: "power", index: 0 },
      { code: "cost-coverage", cost: 1 },
    ],
  ],
  [
    "power",
    { card: { ...first.card, power: 4 } },
    [{ code: "power", index: 0 }],
  ],
  [
    "cost",
    { card: { ...first.card, cost: 0 } },
    [
      { code: "cost", index: 0 },
      { code: "power", index: 0 },
      { code: "cost-coverage", cost: 1 },
    ],
  ],
  [
    "cost",
    { card: { ...first.card, cost: 7 } },
    [
      { code: "cost", index: 0 },
      { code: "power", index: 0 },
      { code: "cost-coverage", cost: 1 },
    ],
  ],
  [
    "cost",
    { card: { ...first.card, cost: NaN } },
    [
      { code: "cost", index: 0 },
      { code: "cost-coverage", cost: 1 },
    ],
  ],
  [
    "power",
    { card: { ...first.card, power: 0 } },
    [{ code: "power", index: 0 }],
  ],
  [
    "power",
    { card: { ...first.card, power: 1.5 } },
    [{ code: "power", index: 0 }],
  ],
  [
    "power",
    { card: { ...first.card, power: Infinity } },
    [{ code: "power", index: 0 }],
  ],
  ["tradition", { tradition: "norse" }, [{ code: "tradition", index: 0 }]],
  ["flavor", { flavor: "x".repeat(121) }, [{ code: "flavor", index: 0 }]],
  ["flavor", { flavor: "   " }, [{ code: "flavor", index: 0 }]],
  ["figure", { figure: "   " }, [{ code: "figure", index: 0 }]],
  [
    "name-figure (name lacks the figure)",
    { card: { ...first.card, name: "Hermes, Keeper of Roads" } },
    [{ code: "name-figure", index: 0 }],
  ],
  [
    "name-figure (no epithet)",
    { card: { ...first.card, name: "Figure 0" } },
    [{ code: "name-figure", index: 0 }],
  ],
  [
    "name-figure (blank epithet)",
    { card: { ...first.card, name: "Figure 0, " } },
    [{ code: "name-figure", index: 0 }],
  ],
  [
    "name-figure (figure differs in case)",
    { figure: "FIGURE 0" },
    [{ code: "name-figure", index: 0 }],
  ],
  [
    "name-figure (no separator)",
    { card: { ...first.card, name: "Figure 0 Keeper of Roads" } },
    [{ code: "name-figure", index: 0 }],
  ],
  ["flavor", { flavor: "" }, [{ code: "flavor", index: 0 }]],
])("rejects %s and accepts the valid counterpart", (_code, patch, expected) => {
  expect(validateRoster(valid)).toEqual([]);
  expect(validateRoster([{ ...first, ...patch }, ...valid.slice(1)])).toEqual(
    expected,
  );
});

test("accepts a figure padded with whitespace and a multi-comma epithet", () => {
  expect(
    validateRoster([
      {
        ...first,
        figure: "  Figure 0  ",
        card: { ...first.card, name: "Figure 0, Keeper, of Roads" },
      },
      ...valid.slice(1),
    ]),
  ).toEqual([]);
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
        card: { ...first.card, id: "extra-card", name: "Figure 0, Extra" },
      },
    ]),
  ).toEqual([]);
});

test.each([2, 3, 4, 5, 6])("rejects power below cost %i", (cost) => {
  // Keep the original coverage intact; add a separate invalid card.
  expect(
    validateRoster([
      ...valid,
      {
        ...first,
        card: {
          id: "weak-card",
          name: "Figure 0, Weak",
          cost,
          power: cost - 1,
        },
      },
    ]),
  ).toEqual([{ code: "power", index: 12 }]);
});

test.each(["", "-a", "a-", "a--b"])("rejects malformed id %s", (id) => {
  expect(
    validateRoster([
      { ...first, card: { ...first.card, id } },
      ...valid.slice(1),
    ]),
  ).toEqual([{ code: "id", index: 0 }]);
});
