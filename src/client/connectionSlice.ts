import { createSlice } from "@reduxjs/toolkit";
import { received, sent, failed } from "./storeActions.ts";
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
  reducers: {},
  extraReducers: (builder) =>
    builder
      .addCase(sent, (state, { payload }) => {
        state.notice = null;
        if (payload.message.type === "join") state.waiting = true;
      })
      .addCase(failed, (state) => {
        state.status = "error";
        state.waiting = false;
      })
      .addCase(received, (state, { payload }) => {
        switch (payload.type) {
          case "welcome":
            state.status = "connected";
            break;
          case "waiting":
            state.waiting = true;
            break;
          case "state":
            state.waiting = false;
            break;
          case "error":
            state.waiting = false;
            state.notice = `Request rejected: ${payload.error}. You can revise and try again.`;
            break;
          default: {
            const exhaustive: never = payload;
            return exhaustive;
          }
        }
      }),
});
export const selectConnection = (state: { connection: ConnectionState }) =>
  state.connection;
