import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { PlayerView } from "../protocol/messages.ts";
import { isAcknowledged } from "./isAcknowledged.ts";
import type { PendingRequest } from "./isAcknowledged.ts";
interface MatchState {
  view: PlayerView | null;
  pending: PendingRequest | null;
}
const initialState: MatchState = { view: null, pending: null };
export const matchSlice = createSlice({
  name: "match",
  initialState,
  reducers: {
    sent(state, { payload }: PayloadAction<PendingRequest>) {
      return { ...state, pending: payload };
    },
    requestCleared(state) {
      state.pending = null;
    },
    /**
     * The player left a finished match; the next screen is Home. Staging is
     * left alone: the next waiting or state frame resets it from the view.
     */
    left() {
      return initialState;
    },
    viewReceived(state, { payload }: PayloadAction<PlayerView>) {
      return {
        view: payload,
        pending: isAcknowledged(state.pending, payload) ? null : state.pending,
      };
    },
  },
});
export const selectMatch = (state: { match: MatchState }) => state.match;
