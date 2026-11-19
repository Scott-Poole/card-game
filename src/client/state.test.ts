import { expect, it } from "vitest";
import type { PlayerView } from "../protocol/messages.ts";
import { locations } from "./stories/fixtures.ts";
import { connectionSlice, selectConnection } from "./connectionSlice.ts";
import { matchSlice, selectMatch } from "./matchSlice.ts";
import { stagingSlice, selectStaging } from "./stagingSlice.ts";
import { selectScreen } from "./navigation.ts";
const connectionActions = connectionSlice.actions;
const matchActions = matchSlice.actions;
const view: PlayerView = {
  phase: "planning",
  result: null,
  turn: 1,
  player: 0,
  energy: 1,
  revealFirst: 0,
  locations,
  own: {
    hand: [],
    deckSize: 8,
    lanes: [[], [], []],
    zones: { destroyed: [], discarded: [], banished: [] },
    staged: [],
    committed: false,
  },
  opponent: {
    handSize: 4,
    deckSize: 8,
    lanes: [[], [], []],
    zones: { destroyed: [], discarded: [], banished: [] },
    committed: false,
  },
  events: [],
};

it("sending join selects Waiting before the queue response", () => {
  const match = matchSlice.reducer(
    undefined,
    matchActions.sent({ message: { type: "join" }, turn: null }),
  );
  expect(
    selectScreen({
      match,
      connection: { status: "connected", notice: null, waiting: false },
    }),
  ).toBe("/waiting");
});
it("a state message for turn 2 replaces the view and selects Match", () => {
  const match = matchSlice.reducer(
    { view, pending: null },
    matchActions.viewReceived({ ...view, turn: 2 }),
  );
  expect(selectMatch({ match }).view?.turn).toBe(2);
  expect(
    selectScreen({
      match,
      connection: { status: "connected", notice: null, waiting: false },
    }),
  ).toBe("/match");
});
it("an opponent update does not acknowledge our pending commit", () => {
  let match = matchSlice.reducer(
    { view, pending: null },
    matchActions.sent({ message: { type: "commit" }, turn: 1 }),
  );
  match = matchSlice.reducer(
    match,
    matchActions.viewReceived({
      ...view,
      opponent: { ...view.opponent, committed: true },
    }),
  );
  expect(selectMatch({ match }).pending?.message.type).toBe("commit");
  match = matchSlice.reducer(
    match,
    matchActions.viewReceived({ ...view, turn: 2 }),
  );
  expect(selectMatch({ match }).pending).toBeNull();
});
it("an ended match selects Result", () => {
  const match = matchSlice.reducer(
    undefined,
    matchActions.viewReceived({
      ...view,
      phase: "ended",
      result: { lanes: [null, null, null], power: [0, 0], winner: null },
    }),
  );
  expect(
    selectScreen({
      match,
      connection: { status: "connected", notice: null, waiting: false },
    }),
  ).toBe("/result");
});
it("a connection failure clears waiting without inventing a rejection notice", () => {
  const connection = connectionSlice.reducer(
    { status: "connected", waiting: true, notice: null },
    connectionActions.failed(),
  );
  expect(selectConnection({ connection })).toEqual({
    status: "error",
    waiting: false,
    notice: null,
  });
});
it("a rejection preserves a queued seat and retry clears its notice", () => {
  let connection = connectionSlice.reducer(
    { status: "connected", waiting: true, notice: null },
    connectionActions.rejected("invalid-message"),
  );
  expect(selectConnection({ connection })).toEqual({
    status: "connected",
    waiting: true,
    notice: "Request rejected: invalid-message. You can revise and try again.",
  });
  connection = connectionSlice.reducer(
    connection,
    connectionActions.requestStarted(),
  );
  expect(selectConnection({ connection }).notice).toBeNull();
});
it("local staging can be replaced by confirmed server plays", () => {
  let staging = stagingSlice.reducer(
    undefined,
    stagingSlice.actions.replaced([{ cardId: "a", lane: 1 }]),
  );
  expect(selectStaging({ staging })).toEqual([{ cardId: "a", lane: 1 }]);
  staging = stagingSlice.reducer(staging, stagingSlice.actions.replaced([]));
  expect(selectStaging({ staging })).toEqual([]);
});
it("a confirmed stage clears the pending request; waiting or rejection can clear it too", () => {
  let match = matchSlice.reducer(
    { view, pending: null },
    matchActions.sent({
      message: { type: "stage", plays: [{ cardId: "a", lane: 1 }] },
      turn: 1,
    }),
  );
  match = matchSlice.reducer(
    match,
    matchActions.viewReceived({
      ...view,
      own: { ...view.own, staged: [{ cardId: "a", lane: 1 }] },
    }),
  );
  expect(selectMatch({ match }).pending).toBeNull();
  match = matchSlice.reducer(
    match,
    matchActions.sent({ message: { type: "commit" }, turn: 1 }),
  );
  match = matchSlice.reducer(match, matchActions.requestCleared());
  expect(selectMatch({ match }).pending).toBeNull();
});
it("leaving a finished match returns to Home", () => {
  const ended: PlayerView = {
    ...view,
    phase: "ended",
    result: { lanes: [0, 1, null], power: [3, 4], winner: 1 },
  };
  const match = matchSlice.reducer(
    matchSlice.reducer(undefined, matchActions.viewReceived(ended)),
    matchActions.left(),
  );
  expect(selectMatch({ match })).toEqual({ view: null, pending: null });
  expect(
    selectScreen({
      match,
      connection: { status: "connected", notice: null, waiting: false },
    }),
  ).toBe("/");
});
