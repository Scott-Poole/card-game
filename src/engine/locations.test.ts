import { expect, test } from "vitest";
import { validateLocations } from "./locations.ts";
import { testLocations } from "./locations.test-support.ts";

const valid = testLocations;
const first = valid[0];
if (!first) throw new Error("Missing fixture");

test("reports a pool that is too small without throwing", () => {
  expect(validateLocations(valid.slice(0, 5))).toEqual([{ code: "pool-size" }]);
  expect(validateLocations([])).toEqual([{ code: "pool-size" }]);
});

test.each([
  ["id", { id: "Bad_id" }, [{ code: "id", index: 0 }]],
  [
    "duplicate-id",
    { id: "place-1" },
    [
      { code: "duplicate-id", index: 0 },
      { code: "duplicate-id", index: 1 },
    ],
  ],
  [
    "duplicate-name",
    { name: "pLACE 1" },
    [
      { code: "duplicate-name", index: 0 },
      { code: "duplicate-name", index: 1 },
    ],
  ],
  ["name", { name: "   " }, [{ code: "name", index: 0 }]],
  ["name", { name: "x".repeat(41) }, [{ code: "name", index: 0 }]],
  ["text", { text: "" }, [{ code: "text", index: 0 }]],
  ["text", { text: "   " }, [{ code: "text", index: 0 }]],
  ["text", { text: "x".repeat(161) }, [{ code: "text", index: 0 }]],
  ["effect", { effect: { kind: "teleport" } }, [{ code: "effect", index: 0 }]],
  [
    "effect amount zero",
    { text: "Adds 0.", effect: { kind: "power-per-card", amount: 0 } },
    [{ code: "effect", index: 0 }],
  ],
  [
    "effect amount three",
    { text: "Adds 3.", effect: { kind: "power-per-card", amount: 3 } },
    [{ code: "effect", index: 0 }],
  ],
  [
    "effect amount non-integer",
    { text: "Adds 1.5.", effect: { kind: "power-per-card", amount: 1.5 } },
    [{ code: "effect", index: 0 }],
  ],
  [
    "effect amount missing",
    { text: "Adds 1.", effect: { kind: "power-per-card" } },
    [{ code: "effect", index: 0 }],
  ],
  [
    "effect-text without the amount",
    {
      text: "Each card here adds power.",
      effect: { kind: "power-per-card", amount: 2 },
    },
    [{ code: "effect-text", index: 0 }],
  ],
])("rejects %s and accepts the valid counterpart", (_code, patch, expected) => {
  expect(validateLocations(valid)).toEqual([]);
  expect(
    validateLocations([{ ...first, ...patch }, ...valid.slice(1)]),
  ).toEqual(expected);
});

test.each([1, 2])(
  "accepts power-per-card amount %i stated in the text",
  (amount) => {
    expect(
      validateLocations([
        {
          ...first,
          text: `Each card you reveal here adds ${String(amount)} power.`,
          effect: { kind: "power-per-card", amount },
        },
        ...valid.slice(1),
      ]),
    ).toEqual([]);
  },
);

test("accepts inclusive bounds and a larger pool", () => {
  expect(
    validateLocations([
      { ...first, name: "x".repeat(40), text: "x".repeat(160) },
      ...valid.slice(1),
      { ...first, id: "extra-place", name: "Extra place" },
    ]),
  ).toEqual([]);
});

test.each(["", "-a", "a-", "a--b"])("rejects malformed id %s", (id) => {
  expect(validateLocations([{ ...first, id }, ...valid.slice(1)])).toEqual([
    { code: "id", index: 0 },
  ]);
});
