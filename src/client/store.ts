/// <reference types="vite/client" />
import { configureStore } from "@reduxjs/toolkit";
import type { ClientMessage } from "../protocol/messages.ts";
import { decodeServerMessage } from "../protocol/messages.ts";
import { connectionSlice } from "./connectionSlice.ts";
import { matchSlice } from "./matchSlice.ts";
import { stagingSlice } from "./stagingSlice.ts";
import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";
const connection = connectionSlice.actions;
const match = matchSlice.actions;
const staging = stagingSlice.actions;

export const store = configureStore({
  reducer: {
    connection: connectionSlice.reducer,
    match: matchSlice.reducer,
    staging: stagingSlice.reducer,
  },
});
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
type AppThunk = ThunkAction<void, RootState, unknown, UnknownAction>;

// One transport for the page lifetime, independent of routes and React mounts.
let socket: WebSocket | null = null;
export function connect() {
  if (socket) return;
  const transport = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
  );
  socket = transport;
  let stopped = false;
  let welcomed = false;
  const fail = () => {
    if (stopped) return;
    stopped = true;
    store.dispatch(connection.failed());
    store.dispatch(match.requestCleared());
    restoreStaging();
    transport.close();
  };
  transport.onmessage = (event: MessageEvent<unknown>) => {
    if (stopped) return;
    const decoded = decodeServerMessage(event.data);
    if (!decoded.ok) {
      fail();
      return;
    }
    if (decoded.message.type === "welcome") welcomed = true;
    if (decoded.message.type === "error" && !welcomed) {
      fail();
      return;
    }
    const message = decoded.message;
    switch (message.type) {
      case "welcome":
        store.dispatch(connection.welcomed());
        break;
      case "waiting":
        store.dispatch(connection.queued());
        store.dispatch(match.requestCleared());
        restoreStaging();
        break;
      case "state":
        store.dispatch(match.viewReceived(message.view));
        store.dispatch(connection.matched());
        if (!store.getState().match.pending) restoreStaging();
        break;
      case "error":
        store.dispatch(match.requestCleared());
        store.dispatch(connection.rejected(message.error));
        restoreStaging();
        break;
      default: {
        const exhaustive: never = message;
        return exhaustive;
      }
    }
  };
  transport.onerror = fail;
  transport.onclose = fail;
}
function restoreStaging() {
  store.dispatch(
    staging.replaced(store.getState().match.view?.own.staged ?? []),
  );
}
export const send =
  (message: ClientMessage): AppThunk =>
  (dispatch, getState) => {
    const { connection: connectionState, match: matchState } = getState();
    if (
      socket?.readyState !== WebSocket.OPEN ||
      connectionState.status !== "connected" ||
      matchState.pending
    )
      return;
    dispatch(connection.requestStarted());
    dispatch(match.sent({ message, turn: matchState.view?.turn ?? null }));
    if (message.type === "stage") dispatch(staging.replaced(message.plays));
    try {
      socket.send(JSON.stringify(message));
    } catch {
      dispatch(connection.failed());
      dispatch(match.requestCleared());
      restoreStaging();
      socket.close();
    }
  };

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (!socket) return;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
  });
}
