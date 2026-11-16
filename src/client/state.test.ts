import { expect, it } from "vitest";
import { connectionSlice, selectConnection } from "./connectionSlice.ts";
import { received, sent, failed } from "./storeActions.ts";

it("joining moves a connected player to waiting", () => {
  let connection = connectionSlice.reducer(
    undefined,
    received({ type: "welcome" }),
  );
  connection = connectionSlice.reducer(
    connection,
    sent({ message: { type: "join" }, turn: null }),
  );
  expect(selectConnection({ connection }).waiting).toBe(true);
});

it("a connection failure clears waiting without inventing a rejection notice", () => {
  const connection = connectionSlice.reducer(
    { status: "connected", waiting: true, notice: null },
    failed(),
  );
  expect(selectConnection({ connection })).toEqual({
    status: "error",
    waiting: false,
    notice: null,
  });
});

import { matchSlice, selectMatch, selectScreen } from "./matchSlice.ts";
import type { PlayerView } from "../protocol/messages.ts";
const view: PlayerView = {
  phase: "planning",
  result: null,
  turn: 1,
  player: 0,
  energy: 1,
  own: {
    hand: [],
    deckSize: 8,
    lanes: [[], [], []],
    staged: [],
    committed: false,
  },
  opponent: { handSize: 4, deckSize: 8, lanes: [[], [], []], committed: false },
  events: [],
};
it("a state message for turn 2 replaces the view", () => {
  const match = matchSlice.reducer(
    undefined,
    received({ type: "state", view: { ...view, turn: 2 } }),
  );
  expect(selectMatch({ match }).view?.turn).toBe(2);
  expect(selectScreen({ match, connection: { waiting: false } })).toBe(
    "/match",
  );
});
import { stagingSlice, selectStaging } from "./stagingSlice.ts";
it("staging records local plays before the server acknowledges them", () => {
  const staging = stagingSlice.reducer(
    undefined,
    sent({
      message: { type: "stage", plays: [{ cardId: "a", lane: 1 }] },
      turn: 1,
    }),
  );
  expect(selectStaging({ staging })).toEqual([{ cardId: "a", lane: 1 }]);
});

it("an opponent update does not acknowledge our pending commit", () => {
  let match = matchSlice.reducer(undefined, received({ type: "state", view }));
  match = matchSlice.reducer(
    match,
    sent({ message: { type: "commit" }, turn: 1 }),
  );
  match = matchSlice.reducer(
    match,
    received({
      type: "state",
      view: { ...view, opponent: { ...view.opponent, committed: true } },
    }),
  );
  expect(selectMatch({ match }).pending?.message.type).toBe("commit");
  match = matchSlice.reducer(
    match,
    received({ type: "state", view: { ...view, turn: 2 } }),
  );
  expect(selectMatch({ match }).pending).toBeNull();
});
it("an ended match selects Result", () => {
  const match = matchSlice.reducer(
    undefined,
    received({
      type: "state",
      view: {
        ...view,
        phase: "ended",
        result: { lanes: [null, null, null], power: [0, 0], winner: null },
      },
    }),
  );
  expect(selectScreen({ match, connection: { waiting: false } })).toBe(
    "/result",
  );
});
it("a rejected request keeps the connection usable and clears the notice on retry", () => {
  let connection = connectionSlice.reducer(
    undefined,
    received({ type: "welcome" }),
  );
  connection = connectionSlice.reducer(
    connection,
    received({ type: "error", error: "invalid-message" }),
  );
  expect(selectConnection({ connection })).toEqual({
    status: "connected",
    waiting: false,
    notice: "Request rejected: invalid-message. You can revise and try again.",
  });
  connection = connectionSlice.reducer(
    connection,
    sent({ message: { type: "join" }, turn: null }),
  );
  expect(selectConnection({ connection }).notice).toBeNull();
});
it("an opponent update preserves local staging and rejection restores confirmed plays", () => {
  let staging = stagingSlice.reducer(
    undefined,
    sent({
      message: { type: "stage", plays: [{ cardId: "a", lane: 1 }] },
      turn: 1,
    }),
  );
  staging = stagingSlice.reducer(staging, received({ type: "state", view }));
  expect(selectStaging({ staging })).toEqual([{ cardId: "a", lane: 1 }]);
  staging = stagingSlice.reducer(
    staging,
    received({ type: "error", error: "invalid-message" }),
  );
  expect(selectStaging({ staging })).toEqual([]);
});
it("an acknowledged stage and a new turn replace local plays with the server view", () => {
  let staging = stagingSlice.reducer(
    undefined,
    sent({
      message: { type: "stage", plays: [{ cardId: "a", lane: 1 }] },
      turn: 1,
    }),
  );
  staging = stagingSlice.reducer(
    staging,
    received({
      type: "state",
      view: {
        ...view,
        own: { ...view.own, staged: [{ cardId: "a", lane: 1 }] },
      },
    }),
  );
  expect(selectStaging({ staging })).toEqual([{ cardId: "a", lane: 1 }]);
  staging = stagingSlice.reducer(
    staging,
    received({ type: "state", view: { ...view, turn: 2 } }),
  );
  expect(selectStaging({ staging })).toEqual([]);
});
