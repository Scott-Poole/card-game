import type { MatchEvent } from "../protocol/messages.ts";

/** The live status line while a turn reveals; `undefined` before the first step. */
export function revealStatusText(
  event: MatchEvent | undefined,
  events: readonly MatchEvent[] = [],
): string {
  switch (event?.type) {
    case "card-revealed":
      return `Revealed ${event.card.name}`;
    case "power-changed":
      return `${powerCardName(event, events)} now has ${String(event.power)} power`;
    case "turn-ended":
      return "Turn ended";
    case "match-ended":
      return "Match ended";
    case undefined:
      return "Revealing turn…";
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** One line of the previous-reveal list. */
export function logEventText(
  event: MatchEvent,
  events: readonly MatchEvent[] = [],
): string {
  switch (event.type) {
    case "card-revealed":
      return `Player ${String(event.player + 1)}: ${event.card.name} in lane ${String(event.lane + 1)}`;
    case "power-changed":
      return `Player ${String(event.player + 1)}: ${powerCardName(event, events)} in lane ${String(event.lane + 1)} now has ${String(event.power)} power`;
    case "turn-ended":
      return `Turn ${String(event.turn)} ended`;
    case "match-ended":
      return "Match ended";
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function powerCardName(
  event: Extract<MatchEvent, { type: "power-changed" }>,
  events: readonly MatchEvent[],
): string {
  const reveal = events.find(
    (candidate) =>
      candidate.type === "card-revealed" &&
      candidate.player === event.player &&
      candidate.card.id === event.cardId,
  );
  return reveal?.type === "card-revealed" ? reveal.card.name : "Card";
}
