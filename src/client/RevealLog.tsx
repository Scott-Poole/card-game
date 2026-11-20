import type { MatchEvent, PlayerView } from "../protocol/messages.ts";
import { button } from "../../styled-system/recipes/index.js";
import BoardPanel from "./BoardPanel.tsx";
import { logEventText, revealStatusText } from "./revealText.ts";

export default function RevealLog({
  view,
  playing,
  revealing,
  step,
  events,
  onSkip,
}: {
  view: PlayerView;
  playing: boolean;
  revealing: boolean;
  /** The event now being revealed, if the reveal has started. */
  step: MatchEvent | undefined;
  /** The last turn's events, listed once the reveal is over. */
  events: readonly MatchEvent[];
  onSkip: () => void;
}) {
  const cardsFor = (event: MatchEvent | undefined) =>
    event?.type === "power-changed"
      ? ((event.player === view.player ? view.own : view.opponent).lanes[
          event.lane
        ] ?? [])
      : [];
  return (
    <BoardPanel
      className="board-reveal"
      playing={playing}
      aria-label="Previous reveal"
    >
      <h2>Previous reveal</h2>
      {revealing && (
        <button autoFocus className={button()} onClick={onSkip}>
          Skip reveal
        </button>
      )}
      {revealing && <p>Escape skips reveal</p>}
      {revealing && (
        <p role="status">{revealStatusText(step, events, cardsFor(step))}</p>
      )}
      <ol>
        {(revealing ? [] : events).map((event, index) => (
          <li key={index}>{logEventText(event, events, cardsFor(event))}</li>
        ))}
      </ol>
    </BoardPanel>
  );
}
