import {
  LANE_COUNT,
  isLocationEffect,
  MAX_LOCATION_NAME,
  MAX_LOCATION_TEXT,
} from "../rules/index.ts";

export const MIN_LOCATION_POOL = 6;

/** The runtime rule every match relies on: a location for every lane, each
 * with its own id. Throws; `validateLocations` is the stricter authoring check. */
export function assertLocationPool(
  pool: readonly { readonly id: string }[],
): void {
  if (pool.length < LANE_COUNT)
    throw new Error("location pool: locations need at least one per lane");
  if (new Set(pool.map((location) => location.id)).size !== pool.length)
    throw new Error("location pool: locations need a unique id per entry");
}

export type LocationIssue =
  | { readonly code: "pool-size" }
  | {
      readonly code:
        | "id"
        | "duplicate-id"
        | "duplicate-name"
        | "name"
        | "text"
        | "effect"
        | "effect-text";
      readonly index: number;
    };

/** Validates authored locations, without changing the pool or throwing. */
export function validateLocations(
  entries: readonly {
    readonly id: string;
    readonly name: string;
    readonly text: string;
    readonly effect: unknown;
  }[],
): readonly LocationIssue[] {
  const issues: LocationIssue[] = [];
  if (entries.length < MIN_LOCATION_POOL) issues.push({ code: "pool-size" });
  entries.forEach((entry, index) => {
    const add = (code: Exclude<LocationIssue["code"], "pool-size">) =>
      issues.push({ code, index });
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)) add("id");
    if (entries.some((other, i) => i !== index && other.id === entry.id))
      add("duplicate-id");
    if (
      entries.some(
        (other, i) =>
          i !== index && other.name.toLowerCase() === entry.name.toLowerCase(),
      )
    )
      add("duplicate-name");
    if (!entry.name.trim() || entry.name.length > MAX_LOCATION_NAME)
      add("name");
    if (!entry.text.trim() || entry.text.length > MAX_LOCATION_TEXT)
      add("text");
    const { effect } = entry;
    const stated = (n: number) =>
      // Rule text must state the number as a whole number, not inside another.
      new RegExp(`(?<![\\d.])${String(n)}(?!\\d|\\.\\d)`).test(entry.text);
    if (!isLocationEffect(effect)) add("effect");
    else if (effect.kind === "power-per-card" && !stated(effect.amount))
      add("effect-text");
    else if (effect.kind === "lane-capacity" && !stated(effect.limit))
      add("effect-text");
  });
  return issues;
}
