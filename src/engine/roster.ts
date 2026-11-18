import { DECK_CARDS_PER_COST } from "../rules/index.ts";
import type { CardDefinition } from "./index.ts";

export interface RosterEntry {
  readonly card: CardDefinition;
  readonly figure: string;
  readonly tradition: "greek" | "roman";
  readonly flavor: string;
}
export type RosterIssue =
  | { readonly code: "cost-coverage"; readonly cost: number }
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
        | "flavor";
      readonly index: number;
    };

/**
 * Validates authored content, without changing the roster or throwing.
 *
 * Each card's name must read `"<figure>, <epithet>"`: it starts with the
 * trimmed `figure` (case-sensitive), then `", "`, then a non-blank epithet. A
 * blank figure is reported as `figure` only, since no name can match it.
 */
export function validateRoster(
  entries: readonly (Omit<RosterEntry, "tradition"> & {
    readonly tradition: string;
  })[],
): readonly RosterIssue[] {
  const issues: RosterIssue[] = [];
  entries.forEach((entry, index) => {
    const { card } = entry;
    const add = (code: Exclude<RosterIssue["code"], "cost-coverage">) =>
      issues.push({ code, index });
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
    if (!Number.isInteger(card.cost) || card.cost < 1 || card.cost > 6)
      add("cost");
    if (
      !Number.isInteger(card.power) ||
      card.power < card.cost ||
      card.power > 3 * card.cost
    )
      add("power");
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
  for (let cost = 1; cost <= 6; cost++) {
    if (
      entries.filter((entry) => entry.card.cost === cost).length <
      DECK_CARDS_PER_COST
    )
      issues.push({ code: "cost-coverage", cost });
  }
  return issues;
}
