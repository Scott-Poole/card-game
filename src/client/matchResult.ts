import type { PlayerView } from "../protocol/messages.ts";
import { opponentOf } from "../rules/index.ts";

export type Outcome = "win" | "loss" | "draw";

export interface ResultSummary {
  readonly winner: Outcome;
  /** One outcome per lane, in lane order. */
  readonly lanes: readonly Outcome[];
  readonly lanesWon: { readonly own: number; readonly opponent: number };
  readonly power: { readonly own: number; readonly opponent: number };
  readonly forfeited: boolean;
}

// Reads only public PlayerView fields: the score, who is viewing, and the
// events that ended the match. Every figure is from the viewer's perspective.
export function summarizeResult(
  view: Extract<PlayerView, { readonly phase: "ended" }>,
): ResultSummary {
  const { player, result, events } = view;
  const outcome = (winner: number | null): Outcome =>
    winner === null ? "draw" : winner === player ? "win" : "loss";
  const lanes = result.lanes.map(outcome);
  const opponent = opponentOf(player);
  return {
    winner: outcome(result.winner),
    lanes,
    lanesWon: {
      own: lanes.filter((lane) => lane === "win").length,
      opponent: lanes.filter((lane) => lane === "loss").length,
    },
    power: {
      own: result.power[player] ?? 0,
      opponent: result.power[opponent] ?? 0,
    },
    // The current server emits only match-ended for a forfeit; normal endings
    // also include turn-ended.
    forfeited: events.length === 1 && events[0]?.type === "match-ended",
  };
}
