import type { CardDefinition, PlayerId } from "../engine/index.ts";

/** Temporary vanilla content, replaced wholesale by the content pipeline. */
export const placeholderRoster: readonly CardDefinition[] = [
  "Asteron of the Dawn",
  "Thaleia of the Forge",
  "Nerion Tidekeeper",
  "Vespera Ashbearer",
  "Caelion Gatewarden",
  "Melara Starweaver",
  "Ortheon of the Grove",
  "Lysara Moonkeeper",
  "Phaeron Stormcaller",
  "Damaris of the Vale",
  "Ilyron Sunwarden",
  "Selara Emberkeeper",
].map((name, index) => ({
  id: `placeholder-${String(index)}`,
  name,
  cost: Math.floor(index / 2) + 1,
  power: (Math.floor(index / 2) + 1) * 2,
}));
export function starterDeck(player: PlayerId): readonly CardDefinition[] {
  return placeholderRoster.map((card) => ({
    ...card,
    id: `${String(player)}:${card.id}`,
  }));
}
