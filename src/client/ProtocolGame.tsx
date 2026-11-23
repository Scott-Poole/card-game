import { usePlayInteraction } from "./usePlayInteraction.ts";
import PlayerTag from "./PlayerTag.tsx";
import { useReveal } from "./useReveal.ts";
import { GameMotion, CardMotionScope } from "./motion.tsx";
import type { Inspection } from "./inspection.ts";
import { useRef, useState } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { DragPreview, HandCard, PlayTarget } from "./PlayInteractions.tsx";
import Card from "./Card.tsx";
import InspectionSheet from "./InspectionSheet.tsx";
import Lane from "./Lane.tsx";
import { selectLaneTotals } from "./laneTotals.ts";
import {
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
import { opponentOf } from "../rules/index.ts";
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
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const hand = useRef<HTMLElement>(null);
  const result = useRef<HTMLElement>(null);
  const dispatch = useAppDispatch();
  const { status, notice, waiting } = useAppSelector(selectConnection);
  const { view: latest, pending } = useAppSelector(selectMatch);
  const { view, active: revealing, skip, step } = useReveal(latest);
  const stagedPlays = useAppSelector(selectStaging);
  const staged = revealing ? [] : stagedPlays;
  const {
    selected,
    setSelected,
    dragging,
    locked,
    available,
    canStage,
    stage,
    laneFull,
    onDragStart,
    onDragEnd,
    registerSlot,
    dropAnimation,
  } = usePlayInteraction({
    view,
    staged,
    revealing,
    pending,
    status,
    hand,
    onStage: () => {
      setInspection(null);
    },
  });
  const spent = selectSpentEnergy(view?.own.hand ?? [], staged);
  const totals = view ? selectLaneTotals(view) : null;
  const ended = selectEnded(view, revealing);
  const commitLabel = selectCommitLabel(view, revealing);
  const standing = view ? selectStanding(view, revealing) : null;
  const playing = view?.phase === "planning" || revealing;
  return (
    <CardMotionScope dragging={dragging}>
      <DragDropProvider onDragStart={onDragStart} onDragEnd={onDragEnd}>
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
                          : step?.event.type === "power-changed"
                            ? step.event.cardId
                            : undefined
                      }
                      registerSlot={(slot, element) => {
                        registerSlot(lane, slot, element);
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
                          enabled={canStage(dragging ?? selected, lane)}
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
        <DragOverlay dropAnimation={dropAnimation}>
          {(source) => {
            const card = view?.own.hand.find((card) => card.id === source.id);
            return card ? (
              <DragPreview card={card} element={source.element} />
            ) : null;
          }}
        </DragOverlay>
        {inspection && (
          <InspectionSheet
            inspection={inspection}
            view={view}
            selected={selected}
            locked={locked}
            available={available}
            onClose={(cancelSelection) => {
              if (cancelSelection) setSelected(null);
              setInspection(null);
            }}
          />
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
