import { useReveal } from "./useReveal.ts";
import { flushSync } from "react-dom";
import { animate } from "motion/react";
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
import PlayerSheet from "./PlayerSheet.tsx";
import Lane from "./Lane.tsx";
import { selectLaneTotals } from "./laneTotals.ts";
import {
  selectActionLocked,
  selectCommitLabel,
  selectEnded,
  selectSpentEnergy,
  selectStanding,
} from "./boardFacts.ts";
import BoardPanel from "./BoardPanel.tsx";
import MatchResult from "./MatchResult.tsx";
import RevealLog from "./RevealLog.tsx";
import { summarizeResult } from "./matchResult.ts";
import { boardStyles } from "./boardStyles.ts";
import Stage from "./Stage.tsx";
import { laneIsFull, legalPlays, opponentOf } from "../rules/index.ts";
import { css, cx } from "../../styled-system/css/index.js";
import { button } from "../../styled-system/recipes/index.js";
import { useAppDispatch, useAppSelector } from "./hooks.ts";
import { selectConnection } from "./connectionSlice.ts";
import { matchSlice, selectMatch } from "./matchSlice.ts";
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
    | { kind: "card"; card: CardData }
    | { kind: "lane"; number: number }
    | { kind: "player"; side: "own" | "opponent" }
    | null
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
  const actionLocked = selectActionLocked({
    view,
    revealing,
    pending,
    status,
  });
  const locked = actionLocked || settling;
  const spent = selectSpentEnergy(view?.own.hand ?? [], staged);
  const available = view
    ? legalPlays({ ...view, own: { ...view.own, staged } })
    : [];
  // The "Lane full" reason applies until the turn is over: an in-flight stage
  // (`pending`) still leaves the lane full.
  const turnOver =
    revealing || (view?.own.committed ?? false) || view?.phase === "ended";
  const laneFull = (lane: number) =>
    view !== null &&
    !turnOver &&
    laneIsFull({ ...view, own: { ...view.own, staged } }, lane);
  const totals = view ? selectLaneTotals(view) : null;
  const ended = selectEnded(view, revealing);
  const commitLabel = selectCommitLabel(view, revealing);
  const standing = view ? selectStanding(view, revealing) : null;
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
                  <PlayerTag
                    label={`Opponent · Player ${String(opponentOf(view.player) + 1)}`}
                    revealsFirst={view.revealFirst === opponentOf(view.player)}
                    onInspect={() => {
                      setSelected(null);
                      setInspection({ kind: "player", side: "opponent" });
                    }}
                  />
                  <div
                    className={css({ textAlign: "center", fontSize: "small" })}
                  >
                    <span role="status">{standing?.headline}</span>
                  </div>
                  <PlayerTag
                    label={`You · Player ${String(view.player + 1)}`}
                    revealsFirst={view.revealFirst === view.player}
                    onInspect={() => {
                      setSelected(null);
                      setInspection({ kind: "player", side: "own" });
                    }}
                  />
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
                          : step?.event.type === "power-changed" ||
                              step?.event.type === "card-destroyed"
                            ? step.event.cardId
                            : undefined
                      }
                      registerSlot={(slot, element) => {
                        const key = `${String(lane)}:${String(slot)}`;
                        if (element) slots.current.set(key, element);
                        else slots.current.delete(key);
                      }}
                      number={lane + 1}
                      location={view.locations[lane]}
                      inspectCard={(card) => {
                        setInspection({ kind: "card", card });
                      }}
                      inspect={() => {
                        setInspection({ kind: "lane", number: lane + 1 });
                      }}
                      playTarget={(children) => (
                        <PlayTarget
                          lane={lane}
                          full={laneFull(lane)}
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
                <BoardPanel
                  layoutScroll
                  className="board-hand"
                  playing={playing}
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
                              aria-description={
                                laneFull(lane) ? "Lane full" : undefined
                              }
                              disabled={!canStage(card.id, lane)}
                              onClick={() => {
                                stage(card.id, lane);
                              }}
                            >
                              Lane {lane + 1}
                              {laneFull(lane) && " full"}
                            </button>
                          ))}
                        </Card>
                      </HandCard>
                    ))}
                </BoardPanel>
                <BoardPanel
                  className="board-staged"
                  playing={playing}
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
                </BoardPanel>
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
                <RevealLog
                  view={view}
                  playing={playing}
                  revealing={revealing}
                  step={step?.event}
                  events={view.events}
                  onSkip={skip}
                />
                {ended && view.phase === "ended" && (
                  <MatchResult
                    summary={summarizeResult(view)}
                    compact={playing}
                    onPlayAgain={() => {
                      dispatch(matchSlice.actions.left());
                    }}
                    ref={result}
                  />
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
                : inspection.kind === "lane"
                  ? (view?.locations[inspection.number - 1]?.name ??
                    `Lane ${String(inspection.number)}`)
                  : inspection.side === "own"
                    ? `You · Player ${String((view?.player ?? 0) + 1)}`
                    : `Opponent · Player ${String(view ? opponentOf(view.player) + 1 : 1)}`
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
                <p>
                  {inspection.card.ability?.text ??
                    "No ability description available."}
                </p>
                {selected === inspection.card.id &&
                  !locked &&
                  available.some(
                    (play) => play.cardId === inspection.card.id,
                  ) && <p>Choose a lane to play this card.</p>}
              </>
            ) : inspection.kind === "lane" ? (
              <>
                <p>Lane {inspection.number}</p>
                <p>
                  {view?.locations[inspection.number - 1]?.text ??
                    "No location effect."}
                </p>
              </>
            ) : view ? (
              <PlayerSheet
                // Switching sides by keyboard keeps this sheet mounted: reset the open zone.
                key={inspection.side}
                view={view}
                side={inspection.side}
              />
            ) : null}
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

/** Opens the player-info sheet; lights up when this player's cards reveal first. */
function PlayerTag({
  label,
  revealsFirst,
  onInspect,
}: {
  label: string;
  revealsFirst: boolean;
  onInspect: () => void;
}) {
  return (
    <button
      data-reveals-first={revealsFirst || undefined}
      className={cx(
        button(),
        css({
          display: "flex",
          alignItems: "center",
          gap: "xs",
          m: "none",
          p: "xs",
          fontSize: "small",
          color: "text",
          bg: "panel",
          minW: "[0]",
          lineHeight: "heading",
          "&[data-reveals-first]": { borderColor: "accent", bg: "raised" },
        }),
      )}
      aria-haspopup="dialog"
      onClick={onInspect}
    >
      <span
        aria-hidden="true"
        className={css({
          flexShrink: 0,
          width: "laneBadge",
          height: "laneBadge",
          border: "panel",
          borderRadius: "control",
          bg: "raised",
        })}
      />
      <span>
        {label}
        {revealsFirst && " · Reveals first"}
      </span>
    </button>
  );
}
