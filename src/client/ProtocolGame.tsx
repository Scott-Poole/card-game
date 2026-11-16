import { legalPlays, TURN_LIMIT } from "../rules/index.ts";
import { css, cx } from "../../styled-system/css/index.js";
import {
  panel,
  button,
  card as cardSurface,
} from "../../styled-system/recipes/index.js";
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
  return (
    <section
      className={css({
        maxW: "content",
        mx: "auto",
        p: { base: "md", md: "lg" },
      })}
    >
      <h2>Card game</h2>
      <p
        className={css({
          color:
            status === "error"
              ? "negative"
              : status === "connected"
                ? "positive"
                : "muted",
        })}
        role="status"
      >
        {status}
      </p>
      {notice && <p role="alert">{notice}</p>}
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
          <h2>
            Turn {view.turn} of {TURN_LIMIT}
          </h2>
          <p>
            Energy: {view.energy - spent} of {view.energy}
          </p>
          <p>
            You are player {view.player + 1}. Opponent hand:{" "}
            {view.opponent.handSize}; deck: {view.opponent.deckSize}. Your deck:{" "}
            {view.own.deckSize}.
          </p>
          {view.opponent.committed && <p>Opponent has committed</p>}
          <div
            className={css({
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: { base: "xs", md: "md" },
            })}
          >
            {view.own.lanes.map((cards, lane) => (
              <section
                className={cx(
                  panel(),
                  css({
                    my: "md",
                    p: { base: "compact", md: "md" },
                    overflowWrap: "anywhere",
                  }),
                )}
                key={lane}
                aria-label={`Lane ${String(lane + 1)}`}
              >
                <h3>Lane {lane + 1}</h3>
                <h4 className={css({ color: "opponent" })}>Opponent</h4>
                <ul>
                  {view.opponent.lanes[lane]?.map((card) => (
                    <li key={card.id}>
                      {card.name} — Power {card.power}
                    </li>
                  ))}
                </ul>
                <h4 className={css({ color: "own" })}>You</h4>
                <ul>
                  {cards.map((card) => (
                    <li key={card.id}>
                      {card.name} — Power {card.power}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <section
            className={cx(
              panel(),
              css({
                my: "md",
                p: { base: "compact", md: "md" },
                overflowWrap: "anywhere",
              }),
            )}
            aria-label="Hand"
          >
            <h2>Hand</h2>
            {view.own.hand
              .filter((card) => !staged.some((play) => play.cardId === card.id))
              .map((card) => (
                <article
                  className={cx(cardSurface(), css({ my: "md" }))}
                  key={card.id}
                >
                  <h3>{card.name}</h3>
                  <p>
                    Cost {card.cost} · Power {card.power}
                  </p>
                  {view.own.lanes.map((_, lane) => (
                    <button
                      className={cx(button(), css({ m: "xs" }))}
                      key={lane}
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
                      Stage {card.name} in lane {lane + 1}
                    </button>
                  ))}
                </article>
              ))}
          </section>
          <section
            className={cx(
              panel(),
              css({
                my: "md",
                p: { base: "compact", md: "md" },
                overflowWrap: "anywhere",
              }),
            )}
            aria-label="Staged cards"
          >
            <h2>Staged cards</h2>
            <ul>
              {staged.map((play) => (
                <li key={play.cardId}>
                  {view.own.hand.find((card) => card.id === play.cardId)?.name}{" "}
                  → Lane {play.lane + 1}{" "}
                  <button
                    className={cx(button(), css({ m: "xs" }))}
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
            className={cx(button(), css({ m: "xs" }))}
            disabled={locked}
            onClick={() => {
              dispatch(send({ type: "commit" }));
            }}
          >
            Commit
          </button>
          {view.own.committed && <p>You have committed</p>}
          <section
            className={cx(
              panel(),
              css({
                my: "md",
                p: { base: "compact", md: "md" },
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
                  p: { base: "compact", md: "md" },
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
  );
}
