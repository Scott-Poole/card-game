import { TURN_LIMIT } from "../rules/index.ts";
import type { LocationEffect, Play } from "../rules/index.ts";
import type { PendingRequest } from "./isAcknowledged.ts";
import { selectLaneTotals } from "./laneTotals.ts";

// Pure facts the board derives from the protocol view plus a few client-only
// inputs (staged plays, whether a reveal is playing, the request in flight and
// the connection). Inputs are structural so tests need no full view. Staging
// legality stays in `rules`.

interface Phased {
  readonly phase: "planning" | "ended";
}

/** The match is over and no reveal is still playing it out. */
export function selectEnded(view: Phased | null, revealing: boolean): boolean {
  return !revealing && view?.phase === "ended";
}

export function selectCommitLabel(
  view: (Phased & { turn: number; own: { committed: boolean } }) | null,
  revealing: boolean,
): string {
  if (!view) return "";
  if (selectEnded(view, revealing)) return "View result";
  if (revealing) return "Revealing…";
  if (view.own.committed) return "Waiting for opponent…";
  return `End turn ${String(view.turn)}/${String(TURN_LIMIT)}`;
}

/** Energy committed to staged plays; a staged card missing from the hand costs nothing. */
export function selectSpentEnergy(
  hand: readonly { readonly id: string; readonly cost: number }[],
  staged: readonly Play[],
): number {
  return staged.reduce(
    (sum, play) =>
      sum + (hand.find((card) => card.id === play.cardId)?.cost ?? 0),
    0,
  );
}

/** The standing headline and how many lanes the player leads (a tie is not a lead). */
export function selectStanding(
  view: Phased & {
    own: { lanes: readonly (readonly { readonly power: number }[])[] };
    opponent: { lanes: readonly (readonly { readonly power: number }[])[] };
    locations: readonly { readonly effect: LocationEffect }[];
  },
  revealing: boolean,
): { headline: string; leading: number } {
  const totals = selectLaneTotals(view);
  const leading = totals.own.filter(
    (total, lane) => total > (totals.opponent[lane] ?? 0),
  ).length;
  const label = selectEnded(view, revealing)
    ? "Final board"
    : "Current standing";
  return {
    headline: `${label}: leading in ${String(leading)} of ${String(view.own.lanes.length)} lanes`,
    leading,
  };
}

/** Whether staging, unstaging and committing are closed to the player. */
export function selectActionLocked(input: {
  view: (Phased & { own: { committed: boolean } }) | null;
  revealing: boolean;
  pending: PendingRequest | null;
  status: "connecting" | "connected" | "error";
}): boolean {
  return (
    input.revealing ||
    input.pending !== null ||
    input.status !== "connected" ||
    (input.view?.own.committed ?? false) ||
    input.view?.phase === "ended"
  );
}
