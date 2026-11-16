import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { Play } from "../protocol/messages.ts";
const initialState: { plays: readonly Play[] } = { plays: [] };
export const stagingSlice = createSlice({
  name: "staging",
  initialState,
  reducers: {
    replaced(_state, { payload }: PayloadAction<readonly Play[]>) {
      return { plays: payload };
    },
  },
});
export const selectStaging = (state: { staging: { plays: readonly Play[] } }) =>
  state.staging.plays;
