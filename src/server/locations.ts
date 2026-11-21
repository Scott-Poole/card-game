import type { LocationDefinition } from "../rules/index.ts";

/** The authored pool every match draws its three lanes' locations from. */
export const locations: readonly LocationDefinition[] = [
  {
    id: "labyrinth-of-knossos",
    name: "Labyrinth of Knossos",
    text: "Each player may reveal at most 3 cards here.",
    effect: { kind: "lane-capacity", limit: 3 },
  },
  {
    id: "styx-crossing",
    name: "Crossing of the Styx",
    text: "No effect for now.",
    effect: { kind: "none" },
  },
  {
    id: "delphic-cleft",
    name: "Oracle's Cleft at Delphi",
    text: "Each player may reveal at most 1 card here.",
    effect: { kind: "lane-capacity", limit: 1 },
  },
  {
    id: "hesperides-grove",
    name: "Grove of the Hesperides",
    text: "Each card you play here adds 1 power.",
    effect: { kind: "power-per-card", amount: 1 },
  },
  {
    id: "temple-of-vesta",
    name: "Hearth of Vesta",
    text: "No effect for now.",
    effect: { kind: "none" },
  },
  {
    id: "palatine-hill",
    name: "Palatine Hill at Dusk",
    text: "Each card you play here adds 1 power.",
    effect: { kind: "power-per-card", amount: 1 },
  },
  {
    id: "forge-beneath-etna",
    name: "Forge Beneath Etna",
    text: "Each card you play here adds 2 power.",
    effect: { kind: "power-per-card", amount: 2 },
  },
  {
    id: "cave-of-the-sibyl",
    name: "Cave of the Sibyl",
    text: "Each player may reveal at most 2 cards here.",
    effect: { kind: "lane-capacity", limit: 2 },
  },
  {
    id: "tiber-ford",
    name: "Ford of the Tiber",
    text: "No effect for now.",
    effect: { kind: "none" },
  },
];
