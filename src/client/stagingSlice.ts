import { createSlice } from "@reduxjs/toolkit";
import type { Play } from "../protocol/messages.ts";
import type { PendingRequest } from "./isAcknowledged.ts";
import { isAcknowledged } from "./isAcknowledged.ts";
import { received, sent, failed } from "./storeActions.ts";
interface StagingState {
  plays: readonly Play[];
  confirmed: readonly Play[];
  request: PendingRequest | null;
}
const initialState: StagingState = { plays: [], confirmed: [], request: null };
export const stagingSlice = createSlice({
  name: "staging",
  initialState,
  reducers: {},
  extraReducers: (builder) =>
    builder
      .addCase(sent, (state, { payload }) => {
        if (payload.message.type === "stage") {
          return { ...state, plays: payload.message.plays, request: payload };
        }
      })
      .addCase(failed, (state) => {
        state.plays = state.confirmed;
        state.request = null;
      })
      .addCase(received, (state, { payload }) => {
        if (payload.type === "state") {
          state.confirmed = [...payload.view.own.staged];
          if (isAcknowledged(state.request, payload.view)) {
            state.plays = state.confirmed;
            state.request = null;
          }
        } else if (payload.type === "error") {
          state.plays = state.confirmed;
          state.request = null;
        }
      }),
});
export const selectStaging = (state: { staging: StagingState }) =>
  state.staging.plays;
