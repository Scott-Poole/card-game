import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";
import type { RootState } from "./store.ts";
export type AppThunk = ThunkAction<void, RootState, unknown, UnknownAction>;
