import type { CardDefinition, PlayerId } from "../engine/index.ts";
import type { RosterEntry } from "../engine/roster.ts";

export const roster: readonly RosterEntry[] = [
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

// Distinct instance ids preserve per-player identity without sending metadata.
export function starterDeck(player: PlayerId): readonly CardDefinition[] {
  return roster.map(({ card }) => ({
    ...card,
    id: `${String(player)}:${card.id}`,
  }));
}
