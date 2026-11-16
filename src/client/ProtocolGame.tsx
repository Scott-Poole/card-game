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
  const dispatch = useAppDispatch();
  const { status, notice, waiting } = useAppSelector(selectConnection);
  const { view, pending } = useAppSelector(selectMatch);
  const staged = useAppSelector(selectStaging);
  const locked =
    pending !== null ||
    status !== "connected" ||
    (view?.own.committed ?? false) ||
    view?.phase === "ended";
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
  const playing = view?.phase === "planning";
  return (
    <Stage active={playing}>
      <section
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
        <p
          className={cx(
            "board-connection",
            css({
              color:
                status === "error"
                  ? "negative"
                  : status === "connected"
                    ? "positive"
                    : "muted",
            }),
          )}
          role="status"
        >
          {status}
        </p>
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
              <Reserved label="Stakes" />
              <span>You · Player {view.player + 1}</span>
            </header>
            <h1 className="board-turn">
              Turn {view.turn} of {TURN_LIMIT}
            </h1>
            <p className="board-energy">
              Energy: {view.energy - spent} of {view.energy}
            </p>
            <p className="board-meta">
              You are player {view.player + 1}. Opponent hand:{" "}
              {view.opponent.handSize}; deck: {view.opponent.deckSize}. Your
              deck: {view.own.deckSize}.
            </p>
            <div className="board-notices">
              <div
                role="group"
                aria-label={`Opponent hand: ${String(view.opponent.handSize)} face-down cards`}
                className={css({
                  display: "flex",
                  gap: "xs",
                  height: "stageTarget",
                })}
              >
                {Array.from({ length: view.opponent.handSize }, (_, index) => (
                  <Card key={index} faceDown size="lane" />
                ))}
              </div>
              {notice && <p role="alert">{notice}</p>}
              {view.opponent.committed && <p>Opponent has committed</p>}
              {view.own.committed && <p>You have committed</p>}
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
                  number={lane + 1}
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
            <section
              className={cx(
                "board-hand",
                panel(),
                css({
                  my: "md",
                  p: playing ? "sm" : { base: "compact", md: "md" },
                  overflowWrap: "anywhere",
                }),
              )}
              aria-label="Hand"
            >
              <h2>Hand</h2>
              {view.own.hand
                .filter(
                  (card) => !staged.some((play) => play.cardId === card.id),
                )
                .map((card) => (
                  <div className="board-card" key={card.id}>
                    <Card data={card} disabled={locked}>
                      {view.own.lanes.map((_, lane) => (
                        <button
                          className={cx(
                            button(),
                            css({ m: "none", p: "xs", fontSize: "small" }),
                          )}
                          key={lane}
                          aria-label={`Stage ${card.name} in lane ${String(lane + 1)}`}
                          disabled={
                            locked ||
                            !available.some(
                              (play) =>
                                play.cardId === card.id && play.lane === lane,
                            )
                          }
                          onClick={() => {
                            dispatch(
                              send({
                                type: "stage",
                                plays: [...staged, { cardId: card.id, lane }],
                              }),
                            );
                          }}
                        >
                          Lane {lane + 1}
                        </button>
                      ))}
                    </Card>
                  </div>
                ))}
            </section>
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
                        view.own.hand.find((card) => card.id === play.cardId)
                          ?.name
                      }
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <button
              className={cx("board-commit", button(), css({ m: "xs" }))}
              disabled={locked}
              onClick={() => {
                dispatch(send({ type: "commit" }));
              }}
            >
              Commit
            </button>
            <button className={cx(button(), "board-retreat")} disabled>
              Retreat
            </button>
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
              <ol>
                {view.events.map((event, index) => (
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
            {view.phase === "ended" && (
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
  );
}

function Reserved({ label }: { label: string }) {
  return (
    <div className="reserved-slot">{import.meta.env.DEV ? label : null}</div>
  );
}
