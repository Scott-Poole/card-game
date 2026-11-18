import {
  isLocationEffectKind,
  isPowerPerCardAmount,
  MAX_LOCATION_NAME,
  MAX_LOCATION_TEXT,
} from "../rules/index.ts";

export const MIN_LOCATION_POOL = 6;

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
    readonly effect: { readonly kind: unknown; readonly amount?: unknown };
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
    if (!isLocationEffectKind(entry.effect.kind)) add("effect");
    else if (entry.effect.kind === "power-per-card") {
      if (!isPowerPerCardAmount(entry.effect.amount)) add("effect");
      // Rule text must state the amount so players read what the lane does.
      else if (!entry.text.includes(String(entry.effect.amount)))
        add("effect-text");
    }
  });
  return issues;
}
