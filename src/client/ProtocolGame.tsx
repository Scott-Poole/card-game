import { useReveal } from "./useReveal.ts";
import { flushSync } from "react-dom";
import { animate, motion } from "motion/react";
import { GameMotion, CardMotionScope, useGameMotion } from "./motion.tsx";
import type { Card as CardData } from "../protocol/messages.ts";
import { useRef, useState, useLayoutEffect } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import {
  DragPreview,
  HandCard,
  Inspect,
  PlayTarget,
} from "./PlayInteractions.tsx";
import Card from "./Card.tsx";
import Lane from "./Lane.tsx";
import { selectLaneTotals } from "./laneTotals.ts";
import { boardStyles } from "./boardStyles.ts";
import Stage from "./Stage.tsx";
import { legalPlays, TURN_LIMIT } from "../rules/index.ts";
import { css, cx } from "../../styled-system/css/index.js";
import { panel, button } from "../../styled-system/recipes/index.js";
import { useAppDispatch, useAppSelector } from "./hooks.ts";
import { selectConnection } from "./connectionSlice.ts";
import { selectMatch } from "./matchSlice.ts";
import { selectStaging } from "./stagingSlice.ts";
import { send } from "./store.ts";

export default function ProtocolGame() {
  return (
    <GameMotion>
      <Game />
    </GameMotion>
  );
}

function Game() {
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [inspection, setInspection] = useState<
    { kind: "card"; card: CardData } | { kind: "lane"; number: number } | null
  >(null);
  const transition = useGameMotion();
  const drop = useRef<{ cardId: string; lane: number } | null>(null);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const [settling, setSettling] = useState(false);
  const hand = useRef<HTMLElement>(null);
  const result = useRef<HTMLElement>(null);
  const wasRevealing = useRef(false);
  const dispatch = useAppDispatch();
  const { status, notice, waiting } = useAppSelector(selectConnection);
  const { view: latest, pending } = useAppSelector(selectMatch);
  const { view, active: revealing, skip, step } = useReveal(latest);
  const stagedPlays = useAppSelector(selectStaging);
  const staged = revealing ? [] : stagedPlays;
  const actionLocked =
    revealing ||
    pending !== null ||
    status !== "connected" ||
    (view?.own.committed ?? false) ||
    view?.phase === "ended";
  const locked = actionLocked || settling;
  const spent = staged.reduce(
    (sum, play) =>
      sum + (view?.own.hand.find((card) => card.id === play.cardId)?.cost ?? 0),
    0,
  );
  const available = view
    ? legalPlays({ ...view, own: { ...view.own, staged } })
    : [];
  const outcome = (winner: number | null) =>
    winner === null ? "Draw" : winner === view?.player ? "You win" : "You lose";
  const totals = view ? selectLaneTotals(view) : null;
  const ended = !revealing && view?.phase === "ended";
  const commitLabel = !view
    ? ""
    : ended
      ? "View result"
      : revealing
        ? "Revealing…"
        : view.own.committed
          ? "Waiting for opponent…"
          : `End turn ${String(view.turn)}/${String(TURN_LIMIT)}`;
  const playing = view?.phase === "planning" || revealing;
  function canStage(
    cardId: string | null,
    lane: number,
    finishingDrop = false,
  ) {
    return (
      !actionLocked &&
      (!settling || finishingDrop) &&
      available.some((play) => play.cardId === cardId && play.lane === lane)
    );
  }
  function stage(cardId: string | null, lane: number, finishingDrop = false) {
    if (cardId === null || !canStage(cardId, lane, finishingDrop)) return;
    dispatch(send({ type: "stage", plays: [...staged, { cardId, lane }] }));
    setSelected(null);
    setInspection(null);
    hand.current?.focus();
  }
  const finishStage = useRef(stage);
  useLayoutEffect(() => {
    finishStage.current = stage;
    if (wasRevealing.current && !revealing) hand.current?.focus();
    wasRevealing.current = revealing;
  });
  return (
    <CardMotionScope dragging={dragging}>
      <DragDropProvider
        onDragStart={(event) => {
          setDragging(String(event.operation.source?.id));
        }}
        onDragEnd={(event) => {
          const { source, target } = event.operation;
          drop.current =
            !event.canceled &&
            source &&
            typeof target?.id === "number" &&
            canStage(String(source.id), target.id)
              ? { cardId: String(source.id), lane: target.id }
              : null;
          setSettling(true);
        }}
      >
        <Stage active={playing}>
          <section
            onKeyDown={(event) => {
              if (event.key === "Escape") setSelected(null);
            }}
            className={cx(
              playing && boardStyles,
              css({
                maxW: "content",
                mx: "auto",
                p: playing ? "md" : { base: "md", md: "lg" },
              }),
            )}
          >
            {!playing && <h2>Card game</h2>}
            {!view && <ConnectionIndicator status={status} />}
            {!view && notice && <p role="alert">{notice}</p>}
            {!view && !waiting && (
              <button
                className={cx(button(), css({ m: "xs" }))}
                disabled={status !== "connected" || pending !== null}
                onClick={() => {
                  dispatch(send({ type: "join" }));
                }}
              >
                Find match
              </button>
            )}
            {waiting && <p>Waiting for an opponent…</p>}
            {view && (
              <>
                <header className="board-tags">
                  <span>Opponent · Player {view.player === 0 ? 2 : 1}</span>
                  <div
                    className={css({ textAlign: "center", fontSize: "small" })}
                  >
                    <span role="status">
                      {ended ? "Final board" : "Current standing"}: leading in{" "}
                      {totals?.own.filter(
                        (total, lane) => total > (totals.opponent[lane] ?? 0),
                      ).length ?? 0}{" "}
                      of {view.own.lanes.length} lanes
                    </span>
                  </div>
                  <span>You · Player {view.player + 1}</span>
                </header>
                <div className="board-notices">
                  <ConnectionIndicator status={status} />
                  {notice && <p role="alert">{notice}</p>}
                  {view.opponent.committed && <p>Opponent has committed</p>}
                </div>
                <div
                  className={cx(
                    "board-lanes",
                    css({
                      display: "grid",
                      gridAutoFlow: "column",
                      gridAutoColumns: "[minmax(0, 1fr)]",
                      gap: "sm",
                    }),
                  )}
                >
                  {view.own.lanes.map((cards, lane) => (
                    <Lane
                      key={lane}
                      revealingCard={
                        step?.event.type === "card-revealed"
                          ? step.event.card.id
                          : undefined
                      }
                      registerSlot={(slot, element) => {
                        const key = `${String(lane)}:${String(slot)}`;
                        if (element) slots.current.set(key, element);
                        else slots.current.delete(key);
                      }}
                      number={lane + 1}
                      inspectCard={(card) => {
                        setInspection({ kind: "card", card });
                      }}
                      inspect={() => {
                        setInspection({ kind: "lane", number: lane + 1 });
                      }}
                      playTarget={(children) => (
                        <PlayTarget
                          lane={lane}
                          active={dragging !== null || selected !== null}
                          enabled={
                            !settling && canStage(dragging ?? selected, lane)
                          }
                          onPlay={() => {
                            stage(selected, lane);
                          }}
                        >
                          {children}
                        </PlayTarget>
                      )}
                      own={cards}
                      opponent={view.opponent.lanes[lane] ?? []}
                      staged={staged
                        .filter((play) => play.lane === lane)
                        .flatMap((play) => {
                          const card = view.own.hand.find(
                            (card) => card.id === play.cardId,
                          );
                          return card ? [card] : [];
                        })}
                      ownTotal={totals?.own[lane] ?? 0}
                      opponentTotal={totals?.opponent[lane] ?? 0}
                    />
                  ))}
                </div>
                <motion.section
                  layoutScroll
                  className={cx(
                    "board-hand",
                    panel(),
                    css({
                      my: "md",
                      p: playing ? "sm" : { base: "compact", md: "md" },
                      overflowWrap: "anywhere",
                    }),
                  )}
                  ref={hand}
                  tabIndex={-1}
                  aria-label="Hand"
                >
                  <h2>Hand</h2>
                  {view.own.hand
                    .filter(
                      (card) => !staged.some((play) => play.cardId === card.id),
                    )
                    .map((card) => (
                      <HandCard id={card.id} disabled={locked} key={card.id}>
                        <Card
                          data={card}
                          disabled={locked}
                          unavailable={card.cost > view.energy - spent}
                          selected={selected === card.id}
                          onInspect={() => {
                            setSelected(card.id);
                            setInspection({ kind: "card", card });
                          }}
                        >
                          {view.own.lanes.map((_, lane) => (
                            <button
                              className={cx(
                                button(),
                                css({ m: "none", p: "xs", fontSize: "small" }),
                              )}
                              key={lane}
                              aria-label={`Stage ${card.name} in lane ${String(lane + 1)}`}
                              disabled={!canStage(card.id, lane)}
                              onClick={() => {
                                stage(card.id, lane);
                              }}
                            >
                              Lane {lane + 1}
                            </button>
                          ))}
                        </Card>
                      </HandCard>
                    ))}
                </motion.section>
                <section
                  className={cx(
                    "board-staged",
                    panel(),
                    css({
                      my: "md",
                      p: playing ? "sm" : { base: "compact", md: "md" },
                      overflowWrap: "anywhere",
                    }),
                  )}
                  aria-label="Staged cards"
                >
                  <h2>Staged cards</h2>
                  <ul>
                    {staged.map((play) => (
                      <li key={play.cardId}>
                        <span>Lane {play.lane + 1}</span>
                        <button
                          className={cx(
                            button(),
                            css({ m: "none", p: "xs", fontSize: "small" }),
                          )}
                          disabled={locked}
                          onClick={() => {
                            dispatch(
                              send({
                                type: "stage",
                                plays: staged.filter(
                                  (other) => other.cardId !== play.cardId,
                                ),
                              }),
                            );
                          }}
                        >
                          Unstage{" "}
                          {
                            view.own.hand.find(
                              (card) => card.id === play.cardId,
                            )?.name
                          }
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
                <div
                  className={cx(
                    "board-actions",
                    css({
                      display: "grid",
                      gridTemplateColumns: "[repeat(3, minmax(0, 1fr))]",
                      alignItems: "center",
                      my: "sm",
                    }),
                  )}
                >
                  <Reserved label="Retreat" />
                  <div
                    role="meter"
                    aria-label="Energy remaining"
                    aria-valuemin={0}
                    aria-valuemax={view.energy}
                    aria-valuenow={view.energy - spent}
                    aria-valuetext={`${String(view.energy - spent)} of ${String(view.energy)}`}
                    className={css({
                      display: "grid",
                      placeItems: "center",
                      width: "orb",
                      height: "orb",
                      justifySelf: "center",
                      borderRadius: "[50%]",
                      border: "focus",
                      bg: "raised",
                      color: "text",
                      fontSize: "heading",
                      fontWeight: "strong",
                    })}
                  >
                    {view.energy - spent}
                  </div>
                  <button
                    className={cx(
                      "board-commit",
                      button(),
                      css({ m: "none", justifySelf: "end" }),
                    )}
                    disabled={ended ? revealing : locked}
                    onClick={() => {
                      if (ended) {
                        result.current?.focus();
                        result.current?.scrollIntoView({ block: "start" });
                      } else dispatch(send({ type: "commit" }));
                    }}
                  >
                    {commitLabel}
                  </button>
                </div>
                <section
                  className={cx(
                    "board-reveal",
                    panel(),
                    css({
                      my: "md",
                      p: playing ? "sm" : { base: "compact", md: "md" },
                      overflowWrap: "anywhere",
                    }),
                  )}
                  aria-label="Previous reveal"
                >
                  <h2>Previous reveal</h2>
                  {revealing && (
                    <button autoFocus className={button()} onClick={skip}>
                      Skip reveal
                    </button>
                  )}
                  {revealing && <p>Escape skips reveal</p>}
                  {revealing && (
                    <p role="status">
                      {step?.event.type === "card-revealed"
                        ? `Revealed ${step.event.card.name}`
                        : step?.event.type === "turn-ended"
                          ? "Turn ended"
                          : step?.event.type === "match-ended"
                            ? "Match ended"
                            : "Revealing turn…"}
                    </p>
                  )}
                  <ol>
                    {(revealing ? [] : view.events).map((event, index) => (
                      <li key={index}>
                        {event.type === "card-revealed"
                          ? `Player ${String(event.player + 1)}: ${event.card.name} in lane ${String(event.lane + 1)}`
                          : event.type === "turn-ended"
                            ? `Turn ${String(event.turn)} ended`
                            : "Match ended"}
                      </li>
                    ))}
                  </ol>
                </section>
                {ended && (
                  <section
                    className={cx(
                      panel(),
                      css({
                        my: "md",
                        p: playing ? "sm" : { base: "compact", md: "md" },
                        overflowWrap: "anywhere",
                      }),
                    )}
                    aria-label="Match result"
                    ref={result}
                    tabIndex={-1}
                  >
                    <h2>Match result</h2>
                    <div role="group" aria-label="Winner">
                      {outcome(view.result.winner)}
                    </div>
                    {/* The current server emits only match-ended for a forfeit; normal endings include turn-ended. */}
                    {view.events.length === 1 &&
                      view.events[0]?.type === "match-ended" && (
                        <p>Forfeit: opponent left the match</p>
                      )}
                    <p>Lane scores on the final board:</p>
                    <ul>
                      {view.result.lanes.map((winner, lane) => (
                        <li key={lane}>
                          Lane {lane + 1}: {outcome(winner)}
                        </li>
                      ))}
                    </ul>
                    <p>Total power: {view.result.power.join(" / ")}</p>
                  </section>
                )}
              </>
            )}
          </section>
        </Stage>
        <DragOverlay
          dropAnimation={async ({ feedbackElement, element, placeholder }) => {
            const play = drop.current;
            // Keep the source in the hand until the overlay finishes: no duplicate lane card.
            const slotIndex = play
              ? (view?.own.lanes[play.lane]?.length ?? 0) +
                staged.filter((item) => item.lane === play.lane).length
              : 0;
            const slot = play
              ? slots.current.get(`${String(play.lane)}:${String(slotIndex)}`)
              : null;
            const destination = slot ?? placeholder ?? element;
            const from = (
              feedbackElement.firstElementChild ?? feedbackElement
            ).getBoundingClientRect();
            const to = destination.getBoundingClientRect();
            try {
              if (feedbackElement instanceof HTMLElement) {
                feedbackElement.style.transformOrigin = "top left";
                await animate(
                  feedbackElement,
                  {
                    // dnd-kit pins transform !important to this variable while dragging.
                    "--dnd-transform": [
                      "translate(0px, 0px) scale(1, 1)",
                      `translate(${String(to.x - from.x)}px, ${String(to.y - from.y)}px) scale(${String(to.width / from.width)}, ${String(to.height / from.height)})`,
                    ],
                  },
                  transition,
                );
              }
            } catch {
              // A detached overlay may cancel its cosmetic animation; still apply the play.
            } finally {
              // Commit the destination before dnd-kit removes the overlay and reveals its source.
              flushSync(() => {
                if (play) finishStage.current(play.cardId, play.lane, true);
                if (drop.current === play) drop.current = null;
                setDragging(null);
                setSettling(false);
              });
            }
          }}
        >
          {(source) => {
            const card = view?.own.hand.find((card) => card.id === source.id);
            return card ? (
              <DragPreview card={card} element={source.element} />
            ) : null;
          }}
        </DragOverlay>
        {inspection && (
          <Inspect
            name={
              inspection.kind === "card"
                ? inspection.card.name
                : `Lane ${String(inspection.number)}`
            }
            onClose={(cancelSelection) => {
              if (cancelSelection) setSelected(null);
              setInspection(null);
            }}
          >
            {inspection.kind === "card" ? (
              <>
                <p>
                  Cost {inspection.card.cost} · Power {inspection.card.power}
                </p>
                <p>No ability description available.</p>
                {selected === inspection.card.id &&
                  !locked &&
                  available.some(
                    (play) => play.cardId === inspection.card.id,
                  ) && <p>Choose a lane to play this card.</p>}
              </>
            ) : (
              <p>No location effect.</p>
            )}
          </Inspect>
        )}
      </DragDropProvider>
    </CardMotionScope>
  );
}

function Reserved({ label }: { label: string }) {
  return (
    <div className="reserved-slot">{import.meta.env.DEV ? label : null}</div>
  );
}

function ConnectionIndicator({
  status,
}: {
  status: "connecting" | "connected" | "error";
}) {
  if (status === "connected") return null;
  return (
    <p
      role="status"
      className={cx(
        "board-connection",
        css({ color: status === "error" ? "negative" : "muted" }),
      )}
    >
      {status}
    </p>
  );
}
