import {
  DECK_CARDS_PER_COST,
  TURN_LIMIT,
  MAX_LOCATION_TEXT,
  isBoostSelfAmount,
  isEffectKind,
  type EffectKind,
} from "../rules/index.ts";
import type { CardDefinition } from "./index.ts";

export interface RosterEntry {
  readonly card: CardDefinition;
  readonly figure: string;
  readonly tradition: "greek" | "roman";
  readonly flavor: string;
}
export type RosterIssue =
  | {
      readonly code: "cost-coverage" | "tier-power";
      readonly cost: number;
    }
  | {
      readonly code:
        | "id"
        | "duplicate-id"
        | "duplicate-name"
        | "cost"
        | "power"
        | "tradition"
        | "figure"
        | "name-figure"
        | "flavor"
        | "ability-text"
        | "effect-text"
        | "effect";
      readonly index: number;
    };

const amountValidators: Readonly<
  Record<EffectKind, (amount: unknown) => boolean>
> = {
  "boost-self": isBoostSelfAmount,
};

/**
 * Validates authored content, without changing the roster or throwing.
 *
 * Each card's name must read `"<figure>, <epithet>"`: it starts with the
 * trimmed `figure` (case-sensitive), then `", "`, then a non-blank epithet. A
 * blank figure is reported as `figure` only, since no name can match it.
 *
 * `tier-power` is a deliberate balance guard: at every cost that has cards,
 * the mean power must equal `2 * cost`, so no cost tier is stronger per energy
 * than another. Individual cards may spread above and below that mean (the
 * `power` check bounds them to `cost`..`3 * cost`), which keeps a deck's draw
 * meaningful without tilting the energy curve.
 */
export function validateRoster(
  entries: readonly (Omit<RosterEntry, "tradition" | "card"> & {
    readonly card: Omit<CardDefinition, "ability"> & {
      readonly ability?: {
        readonly text: string;
        readonly effect?: { readonly kind: unknown; readonly amount?: unknown };
      };
    };
    readonly tradition: string;
  })[],
): readonly RosterIssue[] {
  const issues: RosterIssue[] = [];
  entries.forEach((entry, index) => {
    const { card } = entry;
    const add = (
      code: Exclude<RosterIssue["code"], "cost-coverage" | "tier-power">,
    ) => issues.push({ code, index });
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(card.id)) add("id");
    if (entries.some((other, i) => i !== index && other.card.id === card.id))
      add("duplicate-id");
    if (
      entries.some(
        (other, i) =>
          i !== index &&
          other.card.name.toLowerCase() === card.name.toLowerCase(),
      )
    )
      add("duplicate-name");
    if (!Number.isInteger(card.cost) || card.cost < 1 || card.cost > TURN_LIMIT)
      add("cost");
    if (
      !Number.isInteger(card.power) ||
      card.power < card.cost ||
      card.power > 3 * card.cost
    )
      add("power");
    if (card.ability) {
      const { text, effect } = card.ability;
      if (!text.trim() || text.length > MAX_LOCATION_TEXT) add("ability-text");
      if (
        !effect ||
        !isEffectKind(effect.kind) ||
        !amountValidators[effect.kind](effect.amount)
      )
        add("effect");
      else if (
        typeof effect.amount === "number" &&
        !new RegExp(`(?<![\\d.])${String(effect.amount)}(?!\\d|\\.\\d)`).test(
          text,
        )
      )
        add("effect-text");
    }
    if (entry.tradition !== "greek" && entry.tradition !== "roman")
      add("tradition");
    const figure = entry.figure.trim();
    if (!figure) add("figure");
    else if (
      !card.name.startsWith(`${figure}, `) ||
      !card.name.slice(figure.length + 2).trim()
    )
      add("name-figure");
    if (!entry.flavor.trim() || entry.flavor.length > 120) add("flavor");
  });
  for (let cost = 1; cost <= TURN_LIMIT; cost++) {
    const tier = entries.filter((entry) => entry.card.cost === cost);
    if (tier.length < DECK_CARDS_PER_COST)
      issues.push({ code: "cost-coverage", cost });
    const total = tier.reduce((sum, entry) => sum + entry.card.power, 0);
    if (total !== 2 * cost * tier.length)
      issues.push({ code: "tier-power", cost });
  }
  return issues;
}
