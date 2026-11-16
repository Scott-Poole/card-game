import type { RootState } from "./store.ts";
export function selectScreen(state: Pick<RootState, "match" | "connection">) {
  if (state.match.view)
    return state.match.view.phase === "ended" ? "/result" : "/match";
  return state.connection.waiting ||
    state.match.pending?.message.type === "join"
    ? "/waiting"
    : "/";
}
