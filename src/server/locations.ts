import type { LocationDefinition } from "../rules/index.ts";

const NO_EFFECT = "No effect for now.";

/** The authored pool every match draws its three lanes' locations from. */
export const locations: readonly LocationDefinition[] = [
  {
    id: "labyrinth-of-knossos",
    name: "Labyrinth of Knossos",
    text: NO_EFFECT,
    effect: { kind: "none" },
  },
  {
    id: "styx-crossing",
    name: "Crossing of the Styx",
    text: NO_EFFECT,
    effect: { kind: "none" },
  },
  {
    id: "delphic-cleft",
    name: "Oracle's Cleft at Delphi",
    text: NO_EFFECT,
    effect: { kind: "none" },
  },
  {
    id: "hesperides-grove",
    name: "Grove of the Hesperides",
    text: "Golden fruit feeds all who gather: each of your cards here adds 1 power.",
    effect: { kind: "power-per-card", amount: 1 },
  },
  {
    id: "temple-of-vesta",
    name: "Hearth of Vesta",
    text: NO_EFFECT,
    effect: { kind: "none" },
  },
  {
    id: "palatine-hill",
    name: "Palatine Hill at Dusk",
    text: NO_EFFECT,
    effect: { kind: "none" },
  },
  {
    id: "forge-beneath-etna",
    name: "Forge Beneath Etna",
    text: "The furnace roars for every worker: each of your cards here adds 2 power.",
    effect: { kind: "power-per-card", amount: 2 },
  },
  {
    id: "tiber-ford",
    name: "Ford of the Tiber",
    text: NO_EFFECT,
    effect: { kind: "none" },
  },
];
