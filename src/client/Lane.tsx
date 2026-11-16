import type { Card as CardData } from "../protocol/messages.ts";
import { LANE_CAPACITY } from "../rules/index.ts";
import { panel } from "../../styled-system/recipes/index.js";
import { css, cx } from "../../styled-system/css/index.js";
import Card from "./Card.tsx";

export default function Lane({
  number,
  own,
  opponent,
  staged,
  ownTotal,
  opponentTotal,
}: {
  number: number;
  own: readonly CardData[];
  opponent: readonly CardData[];
  staged: readonly CardData[];
  ownTotal: number;
  opponentTotal: number;
}) {
  return (
    <section
      className={cx(
        panel(),
        css({
          display: "flex",
          flexDirection: "column",
          minH: "lanePanel",
          minW: "[0]",
          p: "sm",
          gap: "xs",
          overflow: "hidden",
        }),
      )}
      aria-label={`Lane ${String(number)}`}
    >
      <header>
        <h3 className={css({ fontSize: "small", m: "none" })}>Lane {number}</h3>
        <div
          aria-label="Location"
          className={css({ minH: "[token(spacing.xs)]", color: "muted" })}
        />
        <p className={css({ m: "none", fontSize: "small", color: "muted" })}>
          Opponent total: {opponentTotal} · Your total: {ownTotal}
        </p>
      </header>
      <Slots label="Opponent cards" cards={opponent} staged={[]} />
      <Slots label="Your cards" cards={own} staged={staged} />
    </section>
  );
}

function Slots({
  label,
  cards,
  staged,
}: {
  label: string;
  cards: readonly CardData[];
  staged: readonly CardData[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={css({
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gridTemplateRows: "repeat(2, minmax(0, 1fr))",
        gap: "xs",
        flex: "1",
        minH: "[0]",
      })}
    >
      {Array.from({ length: LANE_CAPACITY }, (_, slot) => {
        const revealed = cards[slot];
        const data = revealed ?? staged[slot - cards.length];
        return (
          <div
            key={slot}
            className={css({
              border: "panel",
              borderRadius: "control",
              bg: "surface",
              minW: "[0]",
              minH: "[0]",
              overflow: "hidden",
            })}
          >
            {data ? <Card data={data} size="lane" staged={!revealed} /> : null}
          </div>
        );
      })}
    </div>
  );
}
