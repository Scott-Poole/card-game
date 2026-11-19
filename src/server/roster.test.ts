import { expect, test } from "vitest";
import { validateRoster } from "../engine/roster.ts";
import { DECK_CARDS_PER_COST, DECK_SIZE } from "../rules/index.ts";
import { drawDeck, roster } from "./roster.ts";

// The first twelve shipped cards, pinned: later roster work must not change them.
const originals = [
  ["hermes-letterkeeper", 1, 2],
  ["janus-dawnhinge", 1, 2],
  ["ariadne-returnweaver", 2, 4],
  ["flora-orchardwhisper", 2, 4],
  ["hephaestus-quietsmith", 3, 6],
  ["vesta-embertender", 3, 6],
  ["artemis-dewwatcher", 4, 8],
  ["neptune-deepsurveyor", 4, 8],
  ["athena-bridgearchitect", 5, 10],
  ["juno-oathwitness", 5, 10],
  ["demeter-seedkeeper", 6, 12],
  ["saturn-fieldreaper", 6, 12],
] as const;

test("ships twenty-four valid mythic figures, four per cost and two per tradition", () => {
  expect(roster).toHaveLength(24);
  expect(validateRoster(roster)).toEqual([]);
  for (const cost of [1, 2, 3, 4, 5, 6]) {
    const tier = roster.filter((entry) => entry.card.cost === cost);
    expect(tier).toHaveLength(4);
    for (const tradition of ["greek", "roman"])
      expect(tier.filter((e) => e.tradition === tradition)).toHaveLength(2);
  }
  expect(new Set(roster.map((entry) => entry.card.id)).size).toBe(24);
  expect(
    new Set(roster.map((entry) => entry.card.name.toLowerCase())).size,
  ).toBe(24);
  expect(new Set(roster.map((entry) => entry.figure.toLowerCase())).size).toBe(
    24,
  );
});

test("the twelve original cards keep their ids and stats", () => {
  expect(
    roster
      .slice(0, 12)
      .map(({ card }) => [card.id, card.cost, card.power] as const),
  ).toEqual(originals);
});

test("the twelve new cards spread power around each cost's mean", () => {
  for (const cost of [1, 2, 3, 4, 5, 6])
    expect(
      roster
        .slice(12)
        .filter((entry) => entry.card.cost === cost)
        .map((entry) => entry.card.power)
        .sort((x, y) => x - y),
    ).toEqual([2 * cost - 1, 2 * cost + 1]);
});

// Deterministic index source with a different sequence per seed.
function sequence(seed: number) {
  let state = seed;
  return (bound: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 16) % bound;
  };
}

test("a deck is two distinct roster cards per cost, drawn from the roster", () => {
  const deck = drawDeck(1, sequence(7), roster);
  expect(deck).toHaveLength(DECK_SIZE);
  expect(new Set(deck.map((card) => card.id)).size).toBe(DECK_SIZE);
  for (const cost of [1, 2, 3, 4, 5, 6])
    expect(deck.filter((card) => card.cost === cost)).toHaveLength(
      DECK_CARDS_PER_COST,
    );
  for (const card of deck) {
    expect(card.id.startsWith("1:")).toBe(true);
    const source = roster.find((e) => `1:${e.card.id}` === card.id);
    expect(card).toEqual({ ...source?.card, id: card.id });
    expect(Object.keys(card).sort()).toEqual(["cost", "id", "name", "power"]);
  }
});

test("the same index sequence draws the same deck and others draw differently", () => {
  expect(drawDeck(0, sequence(3), roster)).toEqual(
    drawDeck(0, sequence(3), roster),
  );
  const selections = new Set(
    [1, 2, 3, 4, 5].map((seed) =>
      drawDeck(0, sequence(seed), roster)
        .map((card) => card.id)
        .sort()
        .join(),
    ),
  );
  expect(selections.size).toBeGreaterThan(1);
});

test("the shipped roster gives different decks for different index sequences", () => {
  const selections = new Set(
    [1, 2, 3, 4, 5].map((seed) =>
      drawDeck(0, sequence(seed))
        .map((card) => card.id)
        .sort()
        .join(),
    ),
  );
  expect(selections.size).toBeGreaterThan(1);
  for (const seed of [1, 2, 3]) {
    const deck = drawDeck(0, sequence(seed));
    expect(deck).toHaveLength(DECK_SIZE);
    for (const cost of [1, 2, 3, 4, 5, 6])
      expect(deck.filter((card) => card.cost === cost)).toHaveLength(
        DECK_CARDS_PER_COST,
      );
  }
});

test("a deck holds DECK_CARDS_PER_COST cards at each of the six costs", () => {
  expect(DECK_SIZE).toBe(DECK_CARDS_PER_COST * 6);
  expect(DECK_SIZE).toBe(12);
});

test("a roster without enough cards at a cost cannot draw a deck", () => {
  const short = roster.filter((e) => e.card.cost !== 3);
  expect(() => drawDeck(0, sequence(1), short)).toThrow();
});

test("a cost whose cards share an id cannot draw a deck", () => {
  const twins = roster.map((e) => ({
    ...e,
    card: { ...e.card, id: e.card.cost === 1 ? "twin" : e.card.id },
  }));
  expect(() => drawDeck(0, sequence(1), twins)).toThrow();
});
