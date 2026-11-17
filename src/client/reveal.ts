import type { MatchEvent, PlayerView } from "../protocol/messages.ts";
import { selectLaneTotals } from "./laneTotals.ts";

export interface RevealStep {
  readonly event: MatchEvent;
  readonly view: PlayerView;
  readonly totals: ReturnType<typeof selectLaneTotals>;
}

// Event order belongs here; playback only walks the resulting timeline.
export function sequenceReveal(
  previous: PlayerView,
  events: readonly MatchEvent[],
): RevealStep[] {
  let view = previous;
  return events.map((event) => {
    switch (event.type) {
      case "card-revealed": {
        const side = event.player === view.player ? "own" : "opponent";
        const lanes = view[side].lanes.map((cards, lane) =>
          lane === event.lane ? [...cards, event.card] : cards,
        );
        view =
          side === "own"
            ? {
                ...view,
                own: {
                  ...view.own,
                  lanes,
                  staged: [],
                  hand: view.own.hand.filter(
                    (card) => card.id !== event.card.id,
                  ),
                },
              }
            : { ...view, opponent: { ...view.opponent, lanes } };
        break;
      }
      case "turn-ended":
        view = {
          ...view,
          own: { ...view.own, staged: [], committed: false },
          opponent: { ...view.opponent, committed: false },
        };
        break;
      case "match-ended":
        view = { ...view, phase: "ended", result: event.result };
        break;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
    return { event, view, totals: selectLaneTotals(view) };
  });
}
