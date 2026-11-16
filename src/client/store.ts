import { configureStore } from "@reduxjs/toolkit";
import type { ClientMessage } from "../protocol/messages.ts";
import { decodeServerMessage } from "../protocol/messages.ts";
import { connectionSlice } from "./connectionSlice.ts";
import { matchSlice } from "./matchSlice.ts";
import { stagingSlice } from "./stagingSlice.ts";
import { received, sent, failed } from "./storeActions.ts";

export const store = configureStore({
  reducer: {
    connection: connectionSlice.reducer,
    match: matchSlice.reducer,
    staging: stagingSlice.reducer,
  },
});
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

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
    store.dispatch(failed());
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
    store.dispatch(received(decoded.message));
  };
  transport.onerror = fail;
  transport.onclose = fail;
}
export function send(message: ClientMessage) {
  const { connection, match } = store.getState();
  if (
    socket?.readyState !== WebSocket.OPEN ||
    connection.status !== "connected" ||
    match.pending
  )
    return;
  store.dispatch(sent({ message, turn: match.view?.turn ?? null }));
  socket.send(JSON.stringify(message));
}
