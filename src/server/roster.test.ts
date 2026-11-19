import { expect, test } from "vitest";
import { validateRoster } from "../engine/roster.ts";
import { DECK_CARDS_PER_COST, DECK_SIZE } from "../rules/index.ts";
import { drawDeck, roster } from "./roster.ts";

// The twelve original cards, pinned in full and keyed by id: later content
// work may add, reorder or move cards, but must not change these.
const originals = [
  {
    card: {
      id: "hermes-letterkeeper",
      name: "Hermes, Keeper of Unsent Letters",
      cost: 1,
      power: 2,
    },
    figure: "Hermes",
    tradition: "greek",
    flavor: "Every sealed letter leaves a road only he can see.",
  },
  {
    card: {
      id: "janus-dawnhinge",
      name: "Janus, Hinge of Morning",
      cost: 1,
      power: 2,
    },
    figure: "Janus",
    tradition: "roman",
    flavor: "He oils the hinge between yesterday and courage.",
  },
  {
    card: {
      id: "ariadne-returnweaver",
      name: "Ariadne, Weaver of Returns",
      cost: 2,
      power: 4,
    },
    figure: "Ariadne",
    tradition: "greek",
    flavor: "Her thread remembers the way home after the walls forget.",
  },
  {
    card: {
      id: "flora-orchardwhisper",
      name: "Flora, Orchard's First Whisper",
      cost: 2,
      power: 4,
    },
    figure: "Flora",
    tradition: "roman",
    flavor: "She wakes the orchard with a promise smaller than a seed.",
  },
  {
    card: {
      id: "hephaestus-quietsmith",
      name: "Hephaestus, Smith of Quiet Bells",
      cost: 3,
      power: 6,
    },
    figure: "Hephaestus",
    tradition: "greek",
    flavor: "His quietest bell can summon courage from cold iron.",
  },
  {
    card: {
      id: "vesta-embertender",
      name: "Vesta, Tender of Borrowed Fire",
      cost: 3,
      power: 6,
    },
    figure: "Vesta",
    tradition: "roman",
    flavor: "No stranger leaves her hearth carrying an empty ember.",
  },
  {
    card: {
      id: "artemis-dewwatcher",
      name: "Artemis, Watcher of Dewpaths",
      cost: 4,
      power: 8,
    },
    figure: "Artemis",
    tradition: "greek",
    flavor: "She reads the forest in the spaces between falling drops.",
  },
  {
    card: {
      id: "neptune-deepsurveyor",
      name: "Neptune, Surveyor of Deep Roads",
      cost: 4,
      power: 8,
    },
    figure: "Neptune",
    tradition: "roman",
    flavor: "Beneath the keel he draws a road the waves cannot erase.",
  },
  {
    card: {
      id: "athena-bridgearchitect",
      name: "Athena, Architect of Unbuilt Bridges",
      cost: 5,
      power: 10,
    },
    figure: "Athena",
    tradition: "greek",
    flavor:
      "She finds the bridge inside a quarrel before the first stone falls.",
  },
  {
    card: {
      id: "juno-oathwitness",
      name: "Juno, Witness of Iron Vows",
      cost: 5,
      power: 10,
    },
    figure: "Juno",
    tradition: "roman",
    flavor: "An oath beneath her gaze weighs more than any crown.",
  },
  {
    card: {
      id: "demeter-seedkeeper",
      name: "Demeter, Keeper of Winter's Seed",
      cost: 6,
      power: 12,
    },
    figure: "Demeter",
    tradition: "greek",
    flavor: "She counts tomorrow in the seeds winter failed to swallow.",
  },
  {
    card: {
      id: "saturn-fieldreaper",
      name: "Saturn, Reaper of Resting Fields",
      cost: 6,
      power: 12,
    },
    figure: "Saturn",
    tradition: "roman",
    flavor: "His sickle leaves one golden stalk for the coming year.",
  },
];

test("ships twenty-four valid mythic figures, four per cost and two per tradition", () => {
  expect(roster).toHaveLength(24);
  // Clean also means ids and names are unique, names case-insensitively.
  expect(validateRoster(roster)).toEqual([]);
  for (const cost of [1, 2, 3, 4, 5, 6]) {
    const tier = roster.filter((entry) => entry.card.cost === cost);
    expect(tier).toHaveLength(4);
    for (const tradition of ["greek", "roman"])
      expect(tier.filter((e) => e.tradition === tradition)).toHaveLength(2);
  }
  expect(new Set(roster.map((entry) => entry.figure.toLowerCase())).size).toBe(
    24,
  );
});

const originalIds = new Set(originals.map((entry) => entry.card.id));

test("the twelve original cards are unchanged", () => {
  for (const original of originals)
    expect(roster.find((entry) => entry.card.id === original.card.id)).toEqual(
      original,
    );
});

test("the new cards spread power around each cost's mean", () => {
  const added = roster.filter((entry) => !originalIds.has(entry.card.id));
  expect(added).toHaveLength(12);
  for (const cost of [1, 2, 3, 4, 5, 6])
    expect(
      added
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
  expect(drawDeck(0, sequence(3))).toEqual(drawDeck(0, sequence(3), roster));
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
