import type { Card, PlayerView, Play } from "../protocol/messages.ts";
import { opponentOf } from "../rules/index.ts";

export type Inspection =
  | { kind: "card"; card: Card }
  | { kind: "lane"; number: number }
  | { kind: "player"; side: "own" | "opponent" };

export function inspectionFacts(
  inspection: Inspection,
  view: PlayerView | null,
  selected: string | null,
  locked: boolean,
  available: readonly Play[],
) {
  switch (inspection.kind) {
    case "card":
      return {
        kind: inspection.kind,
        name: inspection.card.name,
        stats: `Cost ${String(inspection.card.cost)} · Power ${String(inspection.card.power)}`,
        ability:
          inspection.card.ability?.text ?? "No ability description available.",
        showLaneHint:
          selected === inspection.card.id &&
          !locked &&
          available.some((play) => play.cardId === inspection.card.id),
      };
    case "lane":
      return {
        kind: inspection.kind,
        name:
          view?.locations[inspection.number - 1]?.name ??
          `Lane ${String(inspection.number)}`,
        label: `Lane ${String(inspection.number)}`,
        text:
          view?.locations[inspection.number - 1]?.text ?? "No location effect.",
      };
    case "player":
      return {
        kind: inspection.kind,
        name:
          inspection.side === "own"
            ? `You · Player ${String((view?.player ?? 0) + 1)}`
            : `Opponent · Player ${String(view ? opponentOf(view.player) + 1 : 1)}`,
        side: inspection.side,
      };
    default: {
      const unreachable: never = inspection;
      return unreachable;
    }
  }
}
