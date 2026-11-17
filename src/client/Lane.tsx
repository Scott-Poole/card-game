import { motion } from "motion/react";
import { CardMotion } from "./motion.tsx";
import type { Card as CardData } from "../protocol/messages.ts";
import { LANE_CAPACITY } from "../rules/index.ts";
import { panel } from "../../styled-system/recipes/index.js";
import { css, cx } from "../../styled-system/css/index.js";
import type { ReactNode } from "react";
import Card from "./Card.tsx";

export default function Lane({
  number,
  own,
  opponent,
  staged,
  ownTotal,
  opponentTotal,
  inspect,
  inspectCard,
  playTarget,
  registerSlot,
}: {
  registerSlot?:
    ((slot: number, element: HTMLDivElement | null) => void) | undefined;
  inspect?: () => void;
  inspectCard?: (card: CardData) => void;
  playTarget?: (children: ReactNode) => ReactNode;
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
        <h3 className={css({ fontSize: "small", m: "none" })}>
          {inspect ? (
            <button onClick={inspect}>Lane {number}</button>
          ) : (
            <>Lane {number}</>
          )}
        </h3>
        <div
          aria-label="Location"
          className={css({ minH: "[token(spacing.xs)]", color: "muted" })}
        >
          <motion.span
            key={
              ownTotal === opponentTotal
                ? "tied"
                : ownTotal > opponentTotal
                  ? "own"
                  : "opponent"
            }
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={css({
              m: "none",
              fontSize: "small",
              color:
                ownTotal > opponentTotal
                  ? "positive"
                  : ownTotal < opponentTotal
                    ? "negative"
                    : "muted",
            })}
          >
            {ownTotal === opponentTotal
              ? "Lane tied"
              : ownTotal > opponentTotal
                ? "You lead"
                : "Opponent leads"}
          </motion.span>
        </div>
        <motion.p
          key={`${String(ownTotal)}:${String(opponentTotal)}`}
          initial={{ opacity: 0.5 }}
          animate={{ opacity: 1 }}
          className={css({ m: "none", fontSize: "small", color: "muted" })}
        >
          Opponent total: {opponentTotal} · Your total: {ownTotal}
        </motion.p>
      </header>
      <Slots
        inspectCard={inspectCard}
        label="Opponent cards"
        cards={opponent}
        staged={[]}
      />
      {playTarget ? (
        playTarget(
          <Slots
            inspectCard={inspectCard}
            registerSlot={registerSlot}
            label="Your cards"
            cards={own}
            staged={staged}
          />,
        )
      ) : (
        <Slots
          inspectCard={inspectCard}
          registerSlot={registerSlot}
          label="Your cards"
          cards={own}
          staged={staged}
        />
      )}
    </section>
  );
}

function Slots({
  registerSlot,
  label,
  inspectCard,
  cards,
  staged,
}: {
  registerSlot?:
    ((slot: number, element: HTMLDivElement | null) => void) | undefined;
  label: string;
  inspectCard?: ((card: CardData) => void) | undefined;
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
            key={data?.id ?? `empty-${String(slot)}`}
            ref={(element) => registerSlot?.(slot, element)}
            className={css({
              border: "panel",
              borderRadius: "control",
              bg: "surface",
              minW: "[0]",
              minH: "[0]",
              overflow: "hidden",
            })}
          >
            {data ? (
              <CardMotion id={data.id} flip={!!revealed}>
                <Card
                  data={data}
                  size="lane"
                  staged={!revealed}
                  onInspect={
                    inspectCard
                      ? () => {
                          inspectCard(data);
                        }
                      : undefined
                  }
                />
              </CardMotion>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
