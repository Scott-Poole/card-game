// Starts the production server for browser tests with a controlled location
// pool built from the shipped content: `E2E_LOCATIONS` is "boosted" (the
// Forge Beneath Etna power-per-card lane among two plain ones) or "plain"
// (no effects, so totals equal printed power).
import { startServer } from "../src/server/index.ts";
import { roster, drawDeck } from "../src/server/roster.ts";
import { createMatch } from "../src/engine/index.ts";
import { locations } from "../src/server/locations.ts";

const plain = locations
  .filter((location) => location.effect.kind === "none")
  .slice(0, 3);
function boostedPool() {
  const forge = locations.find(
    (location) => location.id === "forge-beneath-etna",
  );
  if (!forge) throw new Error("shipped pool lost the Forge Beneath Etna");
  return [forge, ...plain.slice(0, 2)];
}
const pool = process.env.E2E_LOCATIONS === "boosted" ? boostedPool() : plain;

// Derive the shuffle permutation once, then invert it to pin opening hands
// while retaining real authored cards and the production two-per-cost deck.
function abilityInputs() {
  const seed = 197;
  const ids = [
    "hermes-letterkeeper",
    "janus-dawnhinge",
    "ariadne-returnweaver",
    "flora-orchardwhisper",
    "hephaestus-quietsmith",
    "vesta-embertender",
    "artemis-dewwatcher",
    "neptune-deepsurveyor",
    "athena-bridgearchitect",
    "juno-oathwitness",
    "demeter-seedkeeper",
    "saturn-fieldreaper",
  ];
  const entries = roster.filter(({ card }) => ids.includes(card.id));
  const decks = [
    drawDeck(0, () => 0, entries),
    drawDeck(1, () => 0, entries),
  ] as const;
  const probe = createMatch(seed, decks, pool);
  const arranged = decks.map((deck, player) => {
    const state = probe.players[player];
    if (!state) throw new Error("Missing probe player");
    const order = [...state.hand, ...state.deck].map((card) =>
      deck.findIndex((entry) => entry.id === card.id),
    );
    const wanted = [
      "hermes-letterkeeper",
      "artemis-dewwatcher",
      "janus-dawnhinge",
    ];
    const entries = [
      ...wanted.map((id) => {
        const entry = roster.find(({ card }) => card.id === id);
        if (!entry) throw new Error("Missing controlled card");
        return { ...entry.card, id: `${String(player)}:${id}` };
      }),
      ...deck.filter((card) => !wanted.some((id) => card.id.endsWith(id))),
    ];
    return deck.map((_, index) => {
      const card = entries[order.indexOf(index)];
      if (!card) throw new Error("Missing controlled draw");
      return card;
    });
  });
  const [first, second] = arranged;
  if (!first || !second) throw new Error("Missing controlled deck");
  const pinned = [first, second] as const;
  const verified = createMatch(seed, pinned, pool);
  for (const player of verified.players)
    if (
      player.hand.map((card) => card.name).join("|") !==
      [
        "Hermes, Keeper of Unsent Letters",
        "Artemis, Watcher of Dewpaths",
        "Janus, Hinge of Morning",
      ].join("|")
    )
      throw new Error(
        "Controlled opening hand no longer matches the ability scenario",
      );
  return { seed, decks: pinned };
}
const server = await startServer({
  port: Number(process.env.PORT ?? "0"),
  clientDirectory: process.env.CLIENT_DIRECTORY ?? "dist",
  locations: pool,
  ...(process.env.E2E_ABILITIES === "true" ? { inputs: abilityInputs } : {}),
});
process.once("SIGTERM", () => {
  server.close();
});
console.log(`Listening on port ${String(server.port)}`);
