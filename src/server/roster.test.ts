import { expect, test } from "vitest";
import { validateRoster } from "../engine/roster.ts";
import { DECK_CARDS_PER_COST, DECK_SIZE } from "../rules/index.ts";
import { doubledRoster } from "./doubled-roster.test-support.ts";
import { drawDeck, roster } from "./roster.ts";

test("ships twelve valid mythic figures, two per cost and both traditions", () => {
  expect(roster).toHaveLength(12);
  expect(validateRoster(roster)).toEqual([]);
  expect(new Set(roster.map((entry) => entry.tradition))).toEqual(
    new Set(["greek", "roman"]),
  );
  for (const cost of [1, 2, 3, 4, 5, 6])
    expect(roster.filter((entry) => entry.card.cost === cost)).toHaveLength(2);
});

// Deterministic index source with a different sequence per seed.
function sequence(seed: number) {
  let state = seed;
  return (bound: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 16) % bound;
  };
}

test("a deck is two distinct roster cards per cost, drawn from a larger roster", () => {
  const deck = drawDeck(1, sequence(7), doubledRoster);
  expect(deck).toHaveLength(DECK_SIZE);
  expect(new Set(deck.map((card) => card.id)).size).toBe(DECK_SIZE);
  for (const cost of [1, 2, 3, 4, 5, 6])
    expect(deck.filter((card) => card.cost === cost)).toHaveLength(
      DECK_CARDS_PER_COST,
    );
  for (const card of deck) {
    expect(card.id.startsWith("1:")).toBe(true);
    const source = doubledRoster.find((e) => `1:${e.card.id}` === card.id);
    expect(card).toEqual({ ...source?.card, id: card.id });
    expect(Object.keys(card).sort()).toEqual(["cost", "id", "name", "power"]);
  }
});

test("the same index sequence draws the same deck and others draw differently", () => {
  expect(drawDeck(0, sequence(3), doubledRoster)).toEqual(
    drawDeck(0, sequence(3), doubledRoster),
  );
  const selections = new Set(
    [1, 2, 3, 4, 5].map((seed) =>
      drawDeck(0, sequence(seed), doubledRoster)
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
    roster.map(({ card }) => `0:${card.id}`).sort(),
  );
});

test("a deck holds DECK_CARDS_PER_COST cards at each of the six costs", () => {
  expect(DECK_SIZE).toBe(DECK_CARDS_PER_COST * 6);
  expect(DECK_SIZE).toBe(12);
});

test("a roster without enough cards at a cost cannot draw a deck", () => {
  const short = doubledRoster.filter((e) => e.card.cost !== 3);
  expect(() => drawDeck(0, sequence(1), short)).toThrow();
});
