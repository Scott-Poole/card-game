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
      aria-description={
        lead === "own"
          ? "You lead"
          : lead === "opponent"
            ? "Opponent leads"
            : "Lane tied"
      }
    >
      <div
        className={css({
          display: "flex",
          flexDirection: "column",
          flex: "1",
          minH: "[0]",
        })}
      >
        {playTarget && (
          <div
            aria-hidden="true"
            className={css({
              h: "[calc(token(sizes.stageTarget) + token(spacing.xs))]",
              flexShrink: 0,
            })}
          />
        )}
        <Slots
          revealingCard={revealingCard}
          inspectCard={inspectCard}
          label="Opponent cards"
          cards={opponent}
          staged={[]}
        />
      </div>
      <header
        className={css({
          position: "relative",
          flexShrink: 0,
          my: "sm",
          border: "panel",
          borderRadius: "panel",
          px: "sm",
          py: "lg",
          bg: lead === "own" ? "laneLeading" : "surface",
          borderColor:
            lead === "own"
              ? "positive"
              : lead === "opponent"
                ? "negative"
                : "border",
          textAlign: "center",
        })}
      >
        <Total
          side="Opponent"
          total={opponentTotal}
          leading={lead === "opponent"}
          tied={lead === "tied"}
        />
        <h3 className={css({ fontSize: "body", m: "none" })}>
          {inspect ? (
            <button
              className={css({
                width: "[100%]",
                cursor: "pointer",
                _focusVisible: { outline: "focus" },
                _after: {
                  content: '""',
                  position: "absolute",
                  inset: "none",
                  borderRadius: "panel",
                },
              })}
              onClick={inspect}
            >
              Lane {number}
            </button>
          ) : (
            <>Lane {number}</>
          )}
        </h3>
        <p className={css({ fontSize: "laneRule", m: "none", color: "muted" })}>
          No location effect.
        </p>
        <p className={css({ srOnly: true })}>
          Opponent total: {opponentTotal} · Your total: {ownTotal}
        </p>
        <Total
          side="Your"
          total={ownTotal}
          leading={lead === "own"}
          tied={lead === "tied"}
        />
      </header>
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

function Total({
  side,
  total,
  leading,
  tied,
}: {
  side: "Your" | "Opponent";
  total: number;
  leading: boolean;
  tied: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={css({
        position: "absolute",
        insetInline: "none",
        top: side === "Opponent" ? "none" : undefined,
        bottom: side === "Your" ? "none" : undefined,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        h: "laneBadge",
        width: "fit-content",
        mx: "auto",
        px: "sm",
        border: "panel",
        borderRadius: "control",
        fontWeight: "strong",
        fontSize: leading ? "heading" : "small",
        bg: leading ? "accent" : "raised",
        color: leading ? "onAccent" : tied ? "text" : "muted",
      })}
    >
      {total}
    </span>
  );
}
