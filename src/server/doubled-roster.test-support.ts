import type { RosterEntry } from "../engine/roster.ts";
import { roster } from "./roster.ts";

/** The shipped roster with a twin of every card: four cards per cost, so a
 * deck draw has real choices. Derived, so it tracks the real roster's shape. */
export const doubledRoster: readonly RosterEntry[] = roster.flatMap((entry) => [
  entry,
  { ...entry, card: { ...entry.card, id: `${entry.card.id}-twin` } },
]);
