import type { MatchEvent, PlayerView } from "../protocol/messages.ts";

export interface RevealStep {
  readonly event: MatchEvent;
  readonly view: PlayerView;
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
      case "power-changed": {
        const side = event.player === view.player ? "own" : "opponent";
        const lanes = view[side].lanes.map((cards, lane) =>
          lane === event.lane
            ? cards.map((card) =>
                card.id === event.cardId
                  ? { ...card, power: event.power }
                  : card,
              )
            : cards,
        );
        view =
          side === "own"
            ? { ...view, own: { ...view.own, lanes } }
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
        view = {
          ...view,
          phase: "ended",
          result: event.result,
          revealFirst: null,
        };
        break;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
    return { event, view };
  });
}
