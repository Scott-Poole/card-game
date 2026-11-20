import type { MatchEvent } from "../protocol/messages.ts";

/** The live status line while a turn reveals; `undefined` before the first step. */
export function revealStatusText(event: MatchEvent | undefined): string {
  switch (event?.type) {
    case "card-revealed":
      return `Revealed ${event.card.name}`;
    case "power-changed":
      return `Power is now ${String(event.power)}`;
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
export function logEventText(event: MatchEvent): string {
  switch (event.type) {
    case "card-revealed":
      return `Player ${String(event.player + 1)}: ${event.card.name} in lane ${String(event.lane + 1)}`;
    case "power-changed":
      return `Player ${String(event.player + 1)}: ${event.cardId} in lane ${String(event.lane + 1)} now has ${String(event.power)} power`;
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
