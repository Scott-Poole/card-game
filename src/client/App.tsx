import { useEffect, useRef, useState } from "react";
import { legalPlays, TURN_LIMIT } from "../rules/index.ts";
import { decodeServerMessage } from "../protocol/messages.ts";
import type { ClientMessage, PlayerView } from "../protocol/messages.ts";
import "./style.css";
import { isAcknowledged } from "./isAcknowledged.ts";
import type { PendingRequest } from "./isAcknowledged.ts";

export default function App() {
  const [status, setStatus] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [view, setView] = useState<PlayerView | null>(null);
  const [pending, setPending] = useState(false);
  const requestRef = useRef<PendingRequest | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
    );
    socketRef.current = socket;
    let failed = false;
    let welcomed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      setStatus("error");
      setWaiting(false);
      requestRef.current = null;
      setPending(false);
      socket.close();
    };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      const decoded = decodeServerMessage(event.data);
      if (!decoded.ok) {
        fail();
        return;
      }
      if (failed) return;
      const message = decoded.message;
      switch (message.type) {
        case "welcome":
          welcomed = true;
          setStatus("connected");
          break;
        case "waiting":
          setWaiting(true);
          requestRef.current = null;
          setPending(false);
          break;
        case "state":
          setView(message.view);
          setWaiting(false);
          {
            if (isAcknowledged(requestRef.current, message.view)) {
              requestRef.current = null;
              setPending(false);
            }
          }
          break;
        case "error":
          if (!welcomed) {
            fail();
            break;
          }
          requestRef.current = null;
          setPending(false);
          setNotice(
            `Request rejected: ${message.error}. You can revise and try again.`,
          );
          break;
        default: {
          const exhaustive: never = message;
          return exhaustive;
        }
      }
    };
    socket.onerror = fail;
    socket.onclose = fail;
    return () => {
      socketRef.current = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    };
  }, []);
  function send(message: ClientMessage) {
    if (
      socketRef.current?.readyState !== WebSocket.OPEN ||
      status !== "connected" ||
      requestRef.current
    )
      return;
    requestRef.current = { message, turn: view?.turn ?? null };
    setNotice(null);
    setPending(true);
    socketRef.current.send(JSON.stringify(message));
  }
  const locked =
    pending ||
    status !== "connected" ||
    (view?.own.committed ?? false) ||
    view?.phase === "ended";
  const spent =
    view?.own.staged.reduce(
      (sum, play) =>
        sum +
        (view.own.hand.find((card) => card.id === play.cardId)?.cost ?? 0),
      0,
    ) ?? 0;
  const available = view ? legalPlays(view) : [];
  const outcome = (winner: number | null) =>
    winner === null ? "Draw" : winner === view?.player ? "You win" : "You lose";
  return (
    <main>
      <h1>Card game</h1>
      <p role="status">{status}</p>
      {notice && <p role="alert">{notice}</p>}
      {!view && !waiting && (
        <button
          disabled={status !== "connected" || pending}
          onClick={() => {
            send({ type: "join" });
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
          <div className="lanes">
            {view.own.lanes.map((cards, lane) => (
              <section key={lane} aria-label={`Lane ${String(lane + 1)}`}>
                <h3>Lane {lane + 1}</h3>
                <h4>Opponent</h4>
                <ul>
                  {view.opponent.lanes[lane]?.map((card) => (
                    <li key={card.id}>
                      {card.name} — Power {card.power}
                    </li>
                  ))}
                </ul>
                <h4>You</h4>
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
          <section aria-label="Hand">
            <h2>Hand</h2>
            {view.own.hand
              .filter(
                (card) =>
                  !view.own.staged.some((play) => play.cardId === card.id),
              )
              .map((card) => (
                <article key={card.id}>
                  <h3>{card.name}</h3>
                  <p>
                    Cost {card.cost} · Power {card.power}
                  </p>
                  {view.own.lanes.map((_, lane) => (
                    <button
                      key={lane}
                      disabled={
                        locked ||
                        !available.some(
                          (play) =>
                            play.cardId === card.id && play.lane === lane,
                        )
                      }
                      onClick={() => {
                        send({
                          type: "stage",
                          plays: [
                            ...view.own.staged,
                            { cardId: card.id, lane },
                          ],
                        });
                      }}
                    >
                      Stage {card.name} in lane {lane + 1}
                    </button>
                  ))}
                </article>
              ))}
          </section>
          <section aria-label="Staged cards">
            <h2>Staged cards</h2>
            <ul>
              {view.own.staged.map((play) => (
                <li key={play.cardId}>
                  {view.own.hand.find((card) => card.id === play.cardId)?.name}{" "}
                  → Lane {play.lane + 1}{" "}
                  <button
                    disabled={locked}
                    onClick={() => {
                      send({
                        type: "stage",
                        plays: view.own.staged.filter(
                          (other) => other.cardId !== play.cardId,
                        ),
                      });
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
            disabled={locked}
            onClick={() => {
              send({ type: "commit" });
            }}
          >
            Commit
          </button>
          {view.own.committed && <p>You have committed</p>}
          <section aria-label="Previous reveal">
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
            <section aria-label="Match result">
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
    </main>
  );
}
