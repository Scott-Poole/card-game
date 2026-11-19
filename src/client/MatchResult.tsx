import type { Ref } from "react";
import { css, cx } from "../../styled-system/css/index.js";
import { panel, button } from "../../styled-system/recipes/index.js";
import type { Outcome, ResultSummary } from "./matchResult.ts";

const outcomeLabel: Record<Outcome, string> = {
  win: "You win",
  loss: "You lose",
  draw: "Draw",
};

export default function MatchResult({
  summary,
  compact,
  onPlayAgain,
  ref,
}: {
  summary: ResultSummary;
  /** Tighter padding while the board is still the main thing on screen. */
  compact: boolean;
  onPlayAgain: () => void;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <section
      className={cx(
        panel(),
        css({
          my: "md",
          p: compact ? "sm" : { base: "compact", md: "md" },
          overflowWrap: "anywhere",
        }),
      )}
      aria-label="Match result"
      ref={ref}
      tabIndex={-1}
    >
      <h2>Match result</h2>
      <div role="group" aria-label="Winner">
        {outcomeLabel[summary.winner]}
      </div>
      {summary.forfeited && <p>Forfeit: opponent left the match</p>}
      {!summary.forfeited && (
        <>
          <p>Lane scores on the final board:</p>
          <ul>
            {summary.lanes.map((lane, index) => (
              <li key={index}>
                Lane {index + 1}: {outcomeLabel[lane]}
              </li>
            ))}
          </ul>
          <p>
            Lanes won: You {summary.lanesWon.own} · Opponent{" "}
            {summary.lanesWon.opponent}
          </p>
          <p>
            Total power: You {summary.power.own} · Opponent{" "}
            {summary.power.opponent}
          </p>
        </>
      )}
      <button className={button()} onClick={onPlayAgain}>
        Play again
      </button>
    </section>
  );
}
