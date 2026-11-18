import { expect, test } from "vitest";
import { validateRoster, type RosterEntry } from "../engine/roster.ts";
import { DECK_CARDS_PER_COST, DECK_SIZE } from "../rules/index.ts";
import { drawDeck, roster, starterDeck } from "./roster.ts";

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

function fixtureRoster(): readonly RosterEntry[] {
  return [1, 2, 3, 4, 5, 6].flatMap((cost) =>
    ["a", "b", "c", "d"].map((letter) => ({
      card: {
        id: `fig-${letter}${String(cost)}`,
        name: `Fig ${letter}${String(cost)}, Test Figure`,
        cost,
        power: 2 * cost,
      },
      figure: `Fig ${letter}${String(cost)}`,
      tradition: "greek" as const,
      flavor: "A fixture.",
    })),
  );
}
// Deterministic pseudo-random index source, one fresh sequence per seed.
function sequence(seed: number) {
  let state = seed;
  return (bound: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % bound;
  };
}

test("a deck is two distinct roster cards per cost, drawn from a larger roster", () => {
  const entries = fixtureRoster();
  const deck = drawDeck(1, sequence(7), entries);
  expect(deck).toHaveLength(DECK_SIZE);
  expect(new Set(deck.map((card) => card.id)).size).toBe(DECK_SIZE);
  for (const cost of [1, 2, 3, 4, 5, 6])
    expect(deck.filter((card) => card.cost === cost)).toHaveLength(
      DECK_CARDS_PER_COST,
    );
  for (const card of deck) {
    expect(card.id.startsWith("1:")).toBe(true);
    const source = entries.find((e) => `1:${e.card.id}` === card.id);
    expect(card).toEqual({ ...source?.card, id: card.id });
    expect(Object.keys(card).sort()).toEqual(["cost", "id", "name", "power"]);
  }
});

test("the same index sequence draws the same deck and others draw differently", () => {
  const entries = fixtureRoster();
  expect(drawDeck(0, sequence(3), entries)).toEqual(
    drawDeck(0, sequence(3), entries),
  );
  const selections = new Set(
    [1, 2, 3, 4, 5].map((seed) =>
      drawDeck(0, sequence(seed), entries)
        .map((card) => card.id)
        .sort()
        .join(),
    ),
  );
  expect(selections.size).toBeGreaterThan(1);
});

test("the shipped roster is small enough that a draw picks every card", () => {
  const deck = drawDeck(0, sequence(11));
  expect(deck.map((card) => card.id).sort()).toEqual(
    starterDeck(0)
      .map((card) => card.id)
      .sort(),
  );
});

test("a deck holds two cards per cost", () => {
  expect(DECK_CARDS_PER_COST).toBe(2);
  expect(DECK_SIZE).toBe(DECK_CARDS_PER_COST * 6);
  expect(DECK_SIZE).toBe(12);
});

test("a roster without enough cards at a cost cannot draw a deck", () => {
  const short = fixtureRoster().filter((e) => e.card.cost !== 3);
  expect(() => drawDeck(0, sequence(1), short)).toThrow();
});
