import { laneIsFull, legalPlays } from "../rules/index.ts";
import type { Play } from "../rules/index.ts";
import type { PlayerView } from "../protocol/messages.ts";
import { selectActionLocked } from "./boardFacts.ts";

export function playAvailability(
  input: Parameters<typeof selectActionLocked>[0] & {
    view: PlayerView | null;
    staged: readonly Play[];
    settling: boolean;
  },
) {
  const { view, staged, revealing, settling } = input;
  const actionLocked = selectActionLocked(input);
  const stagingView = view ? { ...view, own: { ...view.own, staged } } : null;
  const available = stagingView ? legalPlays(stagingView) : [];
  const turnOver =
    revealing || (view?.own.committed ?? false) || view?.phase === "ended";
  return {
    available,
    locked: actionLocked || settling,
    canStage(
      this: void,
      cardId: string | null,
      lane: number,
      finishingDrop = false,
    ) {
      return (
        !actionLocked &&
        (!settling || finishingDrop) &&
        available.some((play) => play.cardId === cardId && play.lane === lane)
      );
    },
    laneFull(this: void, lane: number) {
      return stagingView !== null && !turnOver && laneIsFull(stagingView, lane);
    },
  };
}
