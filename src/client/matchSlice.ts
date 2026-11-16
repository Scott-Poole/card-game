import { createSlice } from "@reduxjs/toolkit";
import type { PlayerView } from "../protocol/messages.ts";
import { isAcknowledged } from "./isAcknowledged.ts";
import type { PendingRequest } from "./isAcknowledged.ts";
import { received, sent, failed } from "./storeActions.ts";
interface MatchState {
  view: PlayerView | null;
  pending: PendingRequest | null;
}
const initialState: MatchState = { view: null, pending: null };
export const matchSlice = createSlice({
  name: "match",
  initialState,
  reducers: {},
  extraReducers: (builder) =>
    builder
      .addCase(sent, (state, { payload }) => {
        return { ...state, pending: payload };
      })
      .addCase(failed, (state) => {
        state.pending = null;
      })
      .addCase(received, (state, { payload }) => {
        if (payload.type === "state") {
          return {
            view: payload.view,
            pending: isAcknowledged(state.pending, payload.view)
              ? null
              : state.pending,
          };
        } else if (payload.type === "waiting" || payload.type === "error")
          state.pending = null;
      }),
});
export const selectMatch = (state: { match: MatchState }) => state.match;
export function selectScreen(state: {
  match: MatchState;
  connection: { waiting: boolean };
}) {
  if (state.match.view)
    return state.match.view.phase === "ended" ? "/result" : "/match";
  return state.connection.waiting ? "/waiting" : "/";
}
