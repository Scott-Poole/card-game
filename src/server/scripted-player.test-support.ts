import {
  decodeServerMessage,
  type ClientMessage,
  type MatchEvent,
  type PlayerView,
} from "../protocol/messages.ts";
import { legalPlays, type Play } from "../rules/index.ts";

/** Test-only protocol client. No host, engine, or fixture knowledge. */
export function scriptedPlayer(seed: number) {
  let current: PlayerView | undefined;
  let eventTurn = 0;
  const events: MatchEvent[] = [];
  function view() {
    if (!current) throw new Error("no state received");
    return current;
  }
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  return {
    events,
    view,
    send(raw: string) {
      const decoded = decodeServerMessage(raw);
      if (!decoded.ok || decoded.message.type !== "state")
        throw new Error("expected state, never error");
      current = decoded.message.view;
      // Events persist through planning updates; record each resolution once.
      const resolvedTurn = current.events.find(
        (event) => event.type === "turn-ended",
      )?.turn;
      if (resolvedTurn !== undefined && resolvedTurn !== eventTurn) {
        events.push(...current.events);
        eventTurn = resolvedTurn;
      }
    },
    act(): readonly ClientMessage[] {
      const state = view();
      const plays: Play[] = [];
      for (;;) {
        const options = legalPlays({
          ...state,
          own: { ...state.own, staged: plays },
        });
        // Include stopping as a choice, so empty and partial stagings occur.
        const play = options[Math.floor(random() * (options.length + 1))];
        if (!play) break;
        plays.push(play);
      }
      return [{ type: "stage", plays }, { type: "commit" }];
    },
  };
}
