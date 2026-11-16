import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { DecodeError } from "../protocol/messages.ts";
interface ConnectionState {
  status: "connecting" | "connected" | "error";
  notice: string | null;
  waiting: boolean;
}
const initialState: ConnectionState = {
  status: "connecting",
  notice: null,
  waiting: false,
};
export const connectionSlice = createSlice({
  name: "connection",
  initialState,
  reducers: {
    welcomed(state) {
      state.status = "connected";
    },
    queued(state) {
      state.waiting = true;
    },
    matched(state) {
      state.waiting = false;
    },
    failed(state) {
      state.status = "error";
      state.waiting = false;
    },
    rejected(state, { payload }: PayloadAction<DecodeError>) {
      state.notice = `Request rejected: ${payload}. You can revise and try again.`;
    },
    requestStarted(state) {
      state.notice = null;
    },
  },
});
export const selectConnection = (state: { connection: ConnectionState }) =>
  state.connection;
