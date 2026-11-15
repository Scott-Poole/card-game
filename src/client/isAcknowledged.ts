import type { ClientMessage, PlayerView } from "../protocol/messages.ts";

export interface PendingRequest {
  message: ClientMessage;
  turn: number | null;
}

export function isAcknowledged(
  request: PendingRequest | null,
  view: PlayerView,
): boolean {
  return (
    !request ||
    request.message.type === "join" ||
    view.phase === "ended" ||
    view.turn !== request.turn ||
    (request.message.type === "commit"
      ? view.own.committed
      : request.message.plays.length === view.own.staged.length &&
        request.message.plays.every((play, index) => {
          const staged = view.own.staged[index];
          return staged?.cardId === play.cardId && staged.lane === play.lane;
        }))
  );
}
