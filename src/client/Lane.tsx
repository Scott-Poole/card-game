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
  revealingCard,
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
  revealingCard?: string | undefined;
  own: readonly CardData[];
  opponent: readonly CardData[];
  staged: readonly CardData[];
  ownTotal: number;
  opponentTotal: number;
}) {
  const lead =
    ownTotal > opponentTotal
      ? "own"
      : ownTotal < opponentTotal
        ? "opponent"
        : "tied";
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
          aria-label="Lane leadership"
          className={css({ minH: "[token(spacing.xs)]", color: "muted" })}
        >
          <motion.span
            key={lead}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={css({
              m: "none",
              fontSize: "small",
              color:
                lead === "own"
                  ? "positive"
                  : lead === "opponent"
                    ? "negative"
                    : "muted",
            })}
          >
            {lead === "tied"
              ? "Lane tied"
              : lead === "own"
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
        revealingCard={revealingCard}
        inspectCard={inspectCard}
        label="Opponent cards"
        cards={opponent}
        staged={[]}
      />
      {playTarget ? (
        playTarget(
          <Slots
            revealingCard={revealingCard}
            inspectCard={inspectCard}
            registerSlot={registerSlot}
            label="Your cards"
            cards={own}
            staged={staged}
          />,
        )
      ) : (
        <Slots
          revealingCard={revealingCard}
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
  revealingCard,
  registerSlot,
  label,
  inspectCard,
  cards,
  staged,
}: {
  registerSlot?:
    ((slot: number, element: HTMLDivElement | null) => void) | undefined;
  revealingCard?: string | undefined;
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
              <CardMotion id={data.id} flip={data.id === revealingCard}>
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
