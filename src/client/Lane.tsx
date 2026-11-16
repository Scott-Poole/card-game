import type { Card as CardData } from "../protocol/messages.ts";
import { LANE_CAPACITY } from "../rules/index.ts";
import { panel } from "../../styled-system/recipes/index.js";
import { css } from "../../styled-system/css/index.js";
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
    <section className={panel()} aria-label={`Lane ${String(number)}`}>
      <header>
        <h3>Lane {number}</h3>
        <p className={css({ m: "none", color: "muted", fontSize: "small" })}>
          Opponent total: {opponentTotal} · Your total: {ownTotal}
        </p>
      </header>
      <h4 className={css({ color: "opponent" })}>Opponent</h4>
      <div
        role="group"
        aria-label="Opponent cards"
        className={css({ display: "contents" })}
      >
        <Slots cards={opponent} staged={[]} />
      </div>
      <h4 className={css({ color: "own" })}>You</h4>
      <div
        role="group"
        aria-label="Your cards"
        className={css({ display: "contents" })}
      >
        <Slots cards={own} staged={staged} />
      </div>
    </section>
  );
}

function Slots({
  cards,
  staged,
}: {
  cards: readonly CardData[];
  staged: readonly CardData[];
}) {
  return (
    <div className="board-slots">
      {Array.from({ length: LANE_CAPACITY }, (_, slot) => {
        const revealed = cards[slot];
        const data = revealed ?? staged[slot - cards.length];
        return (
          <div key={slot} className={css({ minW: "[0]" })}>
            {data ? (
              <Card data={data} size="lane" selected={!revealed} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
