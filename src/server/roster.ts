import {
  shuffle,
  type CardDefinition,
  type PlayerId,
} from "../engine/index.ts";
import { DECK_CARDS_PER_COST, TURN_LIMIT } from "../rules/index.ts";
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
  {
    card: {
      id: "iris-rainstitcher",
      name: "Iris, Stitcher of Rainbow Errands",
      cost: 1,
      power: 1,
    },
    figure: "Iris",
    tradition: "greek",
    flavor: "She carries messages in the seam where rain meets sun.",
  },
  {
    card: {
      id: "faunus-hollowpiper",
      name: "Faunus, Piper of Hollow Stumps",
      cost: 1,
      power: 3,
    },
    figure: "Faunus",
    tradition: "roman",
    flavor: "His reed song coaxes mushrooms up and wolves into politeness.",
  },
  {
    card: {
      id: "orpheus-stringmender",
      name: "Orpheus, Mender of Silent Strings",
      cost: 2,
      power: 5,
    },
    figure: "Orpheus",
    tradition: "greek",
    flavor: "One mended note can make the dark forget it was angry.",
  },
  {
    card: {
      id: "pomona-graftkeeper",
      name: "Pomona, Keeper of Patient Grafts",
      cost: 2,
      power: 3,
    },
    figure: "Pomona",
    tradition: "roman",
    flavor: "She joins two stubborn branches and teaches them to share.",
  },
  {
    card: {
      id: "hecate-crossroadlamp",
      name: "Hecate, Lamplighter of Crossroads",
      cost: 3,
      power: 5,
    },
    figure: "Hecate",
    tradition: "greek",
    flavor: "Her lamp shows each traveler the road they were afraid to name.",
  },
  {
    card: {
      id: "terminus-boundarystone",
      name: "Terminus, Stone of Settled Borders",
      cost: 3,
      power: 7,
    },
    figure: "Terminus",
    tradition: "roman",
    flavor: "He has never moved, and neither has the argument he ended.",
  },
  {
    card: {
      id: "daedalus-waxwright",
      name: "Daedalus, Wright of Borrowed Wings",
      cost: 4,
      power: 9,
    },
    figure: "Daedalus",
    tradition: "greek",
    flavor: "He builds every escape with one eye on the sun's temper.",
  },
  {
    card: {
      id: "fortuna-turnwheel",
      name: "Fortuna, Turner of Idle Wheels",
      cost: 4,
      power: 7,
    },
    figure: "Fortuna",
    tradition: "roman",
    flavor: "She spins once for the proud and twice for the patient.",
  },
  {
    card: {
      id: "apollo-dawnlyrist",
      name: "Apollo, Lyrist of Measured Dawns",
      cost: 5,
      power: 9,
    },
    figure: "Apollo",
    tradition: "greek",
    flavor: "Each dawn arrives on the beat he lets it keep.",
  },
  {
    card: {
      id: "aeneas-emberbearer",
      name: "Aeneas, Bearer of Exiled Embers",
      cost: 5,
      power: 11,
    },
    figure: "Aeneas",
    tradition: "roman",
    flavor: "He crosses burning seas with a city folded inside his coat.",
  },
  {
    card: {
      id: "persephone-thresholdqueen",
      name: "Persephone, Queen of Returning Thresholds",
      cost: 6,
      power: 13,
    },
    figure: "Persephone",
    tradition: "greek",
    flavor: "Spring is only the sound of her door opening twice a year.",
  },
  {
    card: {
      id: "bellona-drumcaller",
      name: "Bellona, Caller of Distant Drums",
      cost: 6,
      power: 11,
    },
    figure: "Bellona",
    tradition: "roman",
    flavor: "Her drums begin in the next valley and finish in your chest.",
  },
];

/** Draws a deck: DECK_CARDS_PER_COST distinct cards at each cost from 1 to
 * TURN_LIMIT. Distinct instance ids preserve per-player identity without
 * sending metadata. Cards come back in cost order; the caller shuffles. */
export function drawDeck(
  player: PlayerId,
  randomIndex: (bound: number) => number,
  entries: readonly RosterEntry[] = roster,
): readonly CardDefinition[] {
  const deck: CardDefinition[] = [];
  for (let cost = 1; cost <= TURN_LIMIT; cost++) {
    const picks = shuffle(
      entries.map((entry) => entry.card).filter((card) => card.cost === cost),
      randomIndex,
    ).slice(0, DECK_CARDS_PER_COST);
    if (
      picks.length < DECK_CARDS_PER_COST ||
      new Set(picks.map((card) => card.id)).size < picks.length
    )
      throw new Error(
        `roster needs ${String(DECK_CARDS_PER_COST)} distinct cards at cost ${String(cost)}`,
      );
    for (const card of picks)
      deck.push({ ...card, id: `${String(player)}:${card.id}` });
  }
  return deck;
}
