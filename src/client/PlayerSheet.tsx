import { useId, useState } from "react";
import { ZONES, type Zone } from "../rules/index.ts";
import type { PlayerView } from "../protocol/messages.ts";
import { css } from "../../styled-system/css/index.js";
import { button } from "../../styled-system/recipes/index.js";

const ZONE_LABELS: Readonly<Record<Zone, string>> = {
  destroyed: "Destroyed",
  discarded: "Discarded",
  banished: "Banished",
};

/** The body of a player's info sheet: deck and hand counts, and the three
 * off-board zones. Every zone is face up, so both players' lists open. */
export default function PlayerSheet({
  view,
  side,
}: {
  view: PlayerView;
  side: "own" | "opponent";
}) {
  const [open, setOpen] = useState<Zone | null>(null);
  const heading = useId();
  const player = view[side];
  const hand = "hand" in player ? player.hand.length : player.handSize;
  const cards = open === null ? [] : player.zones[open];
  return (
    <>
      <p>Deck: {player.deckSize}</p>
      <p>Hand: {hand}</p>
      <div className={css({ display: "flex", gap: "sm", flexWrap: "wrap" })}>
        {ZONES.map((zone) => (
          <button
            key={zone}
            className={button()}
            aria-pressed={open === zone}
            onClick={() => {
              setOpen(open === zone ? null : zone);
            }}
          >
            {ZONE_LABELS[zone]} ({player.zones[zone].length})
          </button>
        ))}
      </div>
      {open !== null && (
        <section aria-labelledby={heading}>
          <h3 id={heading}>{ZONE_LABELS[open]}</h3>
          {cards.length === 0 ? (
            <p>No cards.</p>
          ) : (
            <ul>
              {cards.map((card) => (
                <li key={card.id}>
                  {card.name} · Cost {card.cost} · Power {card.power}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
