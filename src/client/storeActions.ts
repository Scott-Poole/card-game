import { createAction } from "@reduxjs/toolkit";
import type { ServerMessage } from "../protocol/messages.ts";
import type { PendingRequest } from "./isAcknowledged.ts";
export const received = createAction<ServerMessage>("socket/received");
export const sent = createAction<PendingRequest>("socket/sent");
export const failed = createAction("socket/failed");
