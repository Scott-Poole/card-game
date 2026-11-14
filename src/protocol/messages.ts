export type ServerMessage =
  | { type: "welcome" }
  | { type: "error"; error: DecodeError }
  | { type: "waiting" }
  | { type: "state"; view: PlayerView };
export type ClientMessage =
  | { type: "join" }
  | { type: "stage"; plays: readonly Play[] }
  | { type: "commit" };
export type DecodeError =
  "invalid-json" | "invalid-message" | "unrecognized-message";
export type DecodeResult<T> =
  { ok: true; message: T } | { ok: false; error: DecodeError };

// Accept JSON text or a parsed value; JSON text is parsed exactly once.
// Server messages are strict: unknown fields are rejected.
export function decodeServerMessage(
  input: unknown,
): DecodeResult<ServerMessage> {
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      input = parsed;
    } catch {
      return { ok: false, error: "invalid-json" };
    }
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "type" in input &&
    Object.hasOwn(input, "type") &&
    input.type === "welcome" &&
    Object.keys(input).length === 1
  ) {
    return { ok: true, message: { type: "welcome" } };
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "type" in input &&
    Object.hasOwn(input, "type") &&
    input.type === "error" &&
    "error" in input &&
    Object.hasOwn(input, "error") &&
    Object.keys(input).length === 2 &&
    (input.error === "invalid-json" ||
      input.error === "invalid-message" ||
      input.error === "unrecognized-message")
  ) {
    return { ok: true, message: { type: "error", error: input.error } };
  }
  if (isRecord(input) && input.type === "waiting" && exact(input, ["type"]))
    return { ok: true, message: { type: "waiting" } };
  if (
    isRecord(input) &&
    input.type === "state" &&
    exact(input, ["type", "view"]) &&
    isView(input.view)
  )
    return { ok: true, message: { type: "state", view: input.view } };
  return { ok: false, error: "invalid-message" };
}

export function decodeClientMessage(
  input: unknown,
): DecodeResult<ClientMessage> {
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      input = parsed;
    } catch {
      return { ok: false, error: "invalid-json" };
    }
  }
  if (isRecord(input)) {
    if (
      (input.type === "join" || input.type === "commit") &&
      exact(input, ["type"])
    )
      return { ok: true, message: { type: input.type } };
    if (
      input.type === "stage" &&
      exact(input, ["type", "plays"]) &&
      isList(input.plays, isPlay, 12)
    )
      return { ok: true, message: { type: "stage", plays: input.plays } };
    if (
      input.type === "join" ||
      input.type === "stage" ||
      input.type === "commit"
    )
      return { ok: false, error: "invalid-message" };
  }
  return { ok: false, error: "unrecognized-message" };
}

export interface Card {
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly power: number;
}
export interface Play {
  readonly cardId: string;
  readonly lane: number;
}
export type PlayerId = 0 | 1;
export interface Score {
  readonly lanes: readonly (PlayerId | null)[];
  readonly power: readonly number[];
  readonly winner: PlayerId | null;
}
export type MatchEvent =
  | {
      readonly type: "card-revealed";
      readonly player: PlayerId;
      readonly lane: number;
      readonly card: Card;
    }
  | { readonly type: "turn-ended"; readonly turn: number }
  | { readonly type: "match-ended"; readonly result: Score };
export interface OwnPlayer {
  readonly hand: readonly Card[];
  readonly staged: readonly Play[];
  readonly deckSize: number;
  readonly committed: boolean;
  readonly lanes: readonly (readonly Card[])[];
}
export interface Opponent {
  readonly handSize: number;
  readonly deckSize: number;
  readonly committed: boolean;
  readonly lanes: readonly (readonly Card[])[];
}
interface ViewFields {
  readonly player: PlayerId;
  readonly turn: number;
  readonly energy: number;
  readonly own: OwnPlayer;
  readonly opponent: Opponent;
  readonly events: readonly MatchEvent[];
}
export type PlayerView = ViewFields &
  (
    | { readonly phase: "planning"; readonly result: null }
    | { readonly phase: "ended"; readonly result: Score }
  );

function isRecord(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null)
  );
}
function exact(v: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Reflect.ownKeys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k))
  );
}
function integer(
  v: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): v is number {
  return (
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
  );
}
function isList<T>(
  v: unknown,
  guard: (item: unknown) => item is T,
  max: number,
): v is T[] {
  return Array.isArray(v) && v.length <= max && Array.from(v).every(guard);
}
function isPlayer(v: unknown): v is PlayerId {
  return v === 0 || v === 1;
}
function isWinner(v: unknown): v is PlayerId | null {
  return v === null || isPlayer(v);
}
function isCard(v: unknown): v is Card {
  return (
    isRecord(v) &&
    exact(v, ["id", "name", "cost", "power"]) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    integer(v.cost) &&
    integer(v.power)
  );
}
function isPlay(v: unknown): v is Play {
  return (
    isRecord(v) &&
    exact(v, ["cardId", "lane"]) &&
    typeof v.cardId === "string" &&
    integer(v.lane, 0, 2)
  );
}
function isScore(v: unknown): v is Score {
  return (
    isRecord(v) &&
    exact(v, ["lanes", "power", "winner"]) &&
    isList(v.lanes, isWinner, 3) &&
    v.lanes.length === 3 &&
    isList(v.power, (n): n is number => integer(n), 2) &&
    v.power.length === 2 &&
    isWinner(v.winner)
  );
}
function isEvent(v: unknown): v is MatchEvent {
  if (!isRecord(v)) return false;
  switch (v.type) {
    case "card-revealed":
      return (
        exact(v, ["type", "player", "lane", "card"]) &&
        isPlayer(v.player) &&
        integer(v.lane, 0, 2) &&
        isCard(v.card)
      );
    case "turn-ended":
      return exact(v, ["type", "turn"]) && integer(v.turn, 1, 6);
    case "match-ended":
      return exact(v, ["type", "result"]) && isScore(v.result);
    default:
      return false;
  }
}
function isLanes(v: unknown): v is Card[][] {
  return (
    isList(v, (lane): lane is Card[] => isList(lane, isCard, 4), 3) &&
    v.length === 3
  );
}
function isOwn(v: unknown): v is OwnPlayer {
  return (
    isRecord(v) &&
    exact(v, ["hand", "staged", "deckSize", "committed", "lanes"]) &&
    isList(v.hand, isCard, 12) &&
    isList(v.staged, isPlay, 12) &&
    integer(v.deckSize, 0, 12) &&
    typeof v.committed === "boolean" &&
    isLanes(v.lanes)
  );
}
function isOpponent(v: unknown): v is Opponent {
  return (
    isRecord(v) &&
    exact(v, ["handSize", "deckSize", "committed", "lanes"]) &&
    integer(v.handSize, 0, 12) &&
    integer(v.deckSize, 0, 12) &&
    typeof v.committed === "boolean" &&
    isLanes(v.lanes)
  );
}
function isView(v: unknown): v is PlayerView {
  return (
    isRecord(v) &&
    exact(v, [
      "player",
      "turn",
      "energy",
      "own",
      "opponent",
      "events",
      "phase",
      "result",
    ]) &&
    isPlayer(v.player) &&
    integer(v.turn, 1, 6) &&
    integer(v.energy, 0, 6) &&
    isOwn(v.own) &&
    isOpponent(v.opponent) &&
    isList(v.events, isEvent, 26) &&
    ((v.phase === "planning" && v.result === null) ||
      (v.phase === "ended" && isScore(v.result)))
  );
}
