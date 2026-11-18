import { checkStaging, LANE_COUNT, TURN_LIMIT } from "../rules/index.ts";
import type { StagingError } from "../rules/index.ts";
const LANE_IDS = Array.from({ length: LANE_COUNT }, (_, i) => i);
const OPENING_HAND = 3;

export interface CardDefinition {
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly power: number;
}
export type PlayerId = 0 | 1;
export interface Play {
  readonly cardId: string;
  readonly lane: number;
}
export interface PlayerState {
  readonly hand: readonly CardDefinition[];
  readonly deck: readonly CardDefinition[];
  readonly lanes: readonly (readonly CardDefinition[])[];
  readonly staged: readonly Play[];
  readonly committed: boolean;
}
export interface Score {
  readonly lanes: readonly (PlayerId | null)[];
  readonly power: readonly [number, number];
  readonly winner: PlayerId | null;
}
interface MatchFields {
  readonly turn: number;
  readonly energy: number;
  readonly rng: number;
  readonly players: readonly [PlayerState, PlayerState];
  /** Ordered events from the most recent resolved turn; empty before resolution. */
  readonly events: readonly MatchEvent[];
}
type MatchOutcome =
  | { readonly phase: "planning"; readonly result: null }
  | { readonly phase: "ended"; readonly result: Score };
export type MatchState = MatchFields & MatchOutcome;
export type EngineError = StagingError;
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EngineError };
export type MatchEvent =
  | {
      readonly type: "card-revealed";
      readonly player: PlayerId;
      readonly lane: number;
      readonly card: CardDefinition;
    }
  | { readonly type: "turn-ended"; readonly turn: number }
  | { readonly type: "match-ended"; readonly result: Score };
function random(rng: number): number {
  return (Math.imul(rng, 1664525) + 1013904223) >>> 0;
}
/** Returns a shallow shuffled copy. randomIndex must return an integer in [0, bound).
 * Replay contract: sample once per descending bound length, length - 1, ... 2;
 * empty and singleton decks consume no samples. */
export function shuffle(
  cards: readonly CardDefinition[],
  randomIndex: (bound: number) => number,
): CardDefinition[] {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    // Both indices are inside the copied array for a valid index source.
    const a = shuffled[i];
    const b = shuffled[j];
    if (a !== undefined && b !== undefined) {
      shuffled[i] = b;
      shuffled[j] = a;
    }
  }
  return shuffled;
}
/** Card IDs must be unique within each supplied deck.
 * Seeds normalize to uint32. RNG consumption: player 0 shuffle, player 1
 * shuffle, then one sample for each tied reveal-priority flip. Replay uses this ruleset. */
export function createMatch(
  seed: number,
  decks: readonly [readonly CardDefinition[], readonly CardDefinition[]],
): MatchState {
  let rng = seed >>> 0;
  function player(deck: readonly CardDefinition[]): PlayerState {
    const cards = shuffle(
      deck.map((card) => ({ ...card })),
      (bound) => {
        rng = random(rng);
        return Math.floor((rng / 4294967296) * bound);
      },
    );
    return {
      hand: cards.slice(0, OPENING_HAND),
      deck: cards.slice(OPENING_HAND),
      lanes: LANE_IDS.map(() => []),
      staged: [],
      committed: false,
    };
  }
  const players: [PlayerState, PlayerState] = [
    player(decks[0]),
    player(decks[1]),
  ];
  return {
    turn: 1,
    energy: 1,
    rng,
    players,
    phase: "planning",
    result: null,
    events: [],
  };
}
function replace(
  state: MatchState,
  id: PlayerId,
  player: PlayerState,
): MatchState {
  return {
    ...state,
    players: id === 0 ? [player, state.players[1]] : [state.players[0], player],
  };
}
export function stage(
  state: MatchState,
  id: PlayerId,
  plays: readonly Play[],
): Result<MatchState> {
  const player = state.players[id];
  const checked = checkStaging(playerView(state, id), plays);
  if (!checked.ok) return checked;
  return {
    ok: true,
    value: replace(state, id, {
      ...player,
      staged: plays.map((p) => ({ ...p })),
    }),
  };
}
export function commit(state: MatchState, id: PlayerId): Result<MatchState> {
  if (state.phase !== "planning") return { ok: false, error: "wrong-phase" };
  const player = state.players[id];
  if (player.committed) return { ok: false, error: "already-committed" };
  return {
    ok: true,
    value: replace(state, id, { ...player, committed: true }),
  };
}
export type PlayerAction =
  | { readonly type: "stage"; readonly plays: readonly Play[] }
  | { readonly type: "commit" };

/** Applies one action, including resolution when it completes both commits. */
export function applyAction(
  state: MatchState,
  id: PlayerId,
  action: PlayerAction,
): Result<MatchState> {
  switch (action.type) {
    case "stage":
      return stage(state, id, action.plays);
    case "commit": {
      const committed = commit(state, id);
      if (!committed.ok) return committed;
      if (!committed.value.players.every((p) => p.committed)) return committed;
      const resolved = resolve(committed.value);
      return resolved.ok ? { ok: true, value: resolved.value.state } : resolved;
    }
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

function winner(a: number, b: number): PlayerId | null {
  return a === b ? null : a > b ? 0 : 1;
}
function score(state: MatchState): Score {
  const powers = state.players.map((p) =>
    p.lanes.map((l) => l.reduce((sum, c) => sum + c.power, 0)),
  );
  const a = powers[0] ?? [];
  const b = powers[1] ?? [];
  const lanes = LANE_IDS.map((i) => winner(a[i] ?? 0, b[i] ?? 0));
  const power: [number, number] = [
    a.reduce((s, n) => s + n, 0),
    b.reduce((s, n) => s + n, 0),
  ];
  return {
    lanes,
    power,
    winner:
      winner(
        lanes.filter((l) => l === 0).length,
        lanes.filter((l) => l === 1).length,
      ) ?? winner(...power),
  };
}
/** Who reveals first this turn: the player leading the board (lanes, then
 * total power); a tied board, including turn 1, is broken by a flip seeded
 * from the match RNG. Pure: `rng` is the state after the flip, which only
 * resolution commits. Board and RNG are fixed during planning, so the answer
 * is stable from the start of the turn until it resolves. */
function revealPriority(state: MatchState): {
  readonly first: PlayerId;
  readonly rng: number;
} {
  const leader = score(state).winner;
  if (leader !== null) return { first: leader, rng: state.rng };
  const rng = random(state.rng);
  return { first: rng < 2147483648 ? 0 : 1, rng };
}
export function resolve(state: MatchState): Result<{
  readonly state: MatchState;
  readonly events: readonly MatchEvent[];
}> {
  if (state.phase !== "planning" || !state.players.every((p) => p.committed))
    return { ok: false, error: "wrong-phase" };
  const { first, rng } = revealPriority(state);
  const order: PlayerId[] = [first, first === 0 ? 1 : 0];
  let next: MatchState = { ...state, rng };
  const events: MatchEvent[] = [];
  for (const id of order) {
    const player = next.players[id];
    const lanes = player.lanes.map((l) => [...l]);
    for (const play of player.staged) {
      const card = player.hand.find((c) => c.id === play.cardId);
      const lane = lanes[play.lane];
      // stage validates both lookups; committed plays cannot change through this API.
      if (card && lane) {
        lane.push(card);
        events.push({
          type: "card-revealed",
          player: id,
          lane: play.lane,
          card,
        });
      }
    }
    next = replace(next, id, {
      ...player,
      lanes,
      hand: player.hand.filter(
        (c) => !player.staged.some((p) => p.cardId === c.id),
      ),
      staged: [],
      committed: false,
    });
  }
  events.push({ type: "turn-ended", turn: state.turn });
  if (state.turn === TURN_LIMIT) {
    const result = score(next);
    next = { ...next, phase: "ended", result };
    events.push({ type: "match-ended", result });
  } else {
    function draw(p: PlayerState): PlayerState {
      return {
        ...p,
        hand: [...p.hand, ...p.deck.slice(0, 1)],
        deck: p.deck.slice(1),
      };
    }
    next = {
      ...next,
      turn: state.turn + 1,
      energy: state.turn + 1,
      players: [draw(next.players[0]), draw(next.players[1])],
    };
  }
  return { ok: true, value: { state: { ...next, events }, events } };
}

export interface PublicPlayerView {
  readonly deckSize: number;
  readonly lanes: readonly (readonly CardDefinition[])[];
  readonly committed: boolean;
}
interface PlayerViewFields {
  readonly player: PlayerId;
  readonly own: PublicPlayerView & {
    readonly hand: readonly CardDefinition[];
    readonly staged: readonly Play[];
  };
  readonly opponent: PublicPlayerView & { readonly handSize: number };
  readonly turn: number;
  readonly energy: number;
  /** Who reveals first this turn; null once the match has ended. */
  readonly revealFirst: PlayerId | null;
  readonly events: readonly MatchEvent[];
}
export type PlayerView = PlayerViewFields & MatchOutcome;
/** Explicitly select public fields: never spread a full player or match state. */
export function playerView(state: MatchState, id: PlayerId): PlayerView {
  function publicPlayer(player: PlayerState): PublicPlayerView {
    return {
      deckSize: player.deck.length,
      lanes: player.lanes,
      committed: player.committed,
    };
  }
  const own = state.players[id];
  const opponent = state.players[id === 0 ? 1 : 0];
  const fields = {
    player: id,
    turn: state.turn,
    energy: state.energy,
    revealFirst: state.phase === "ended" ? null : revealPriority(state).first,
    own: { ...publicPlayer(own), hand: own.hand, staged: own.staged },
    opponent: { ...publicPlayer(opponent), handSize: opponent.hand.length },
    events: state.events,
  };
  return state.phase === "ended"
    ? { ...fields, phase: "ended", result: state.result }
    : { ...fields, phase: "planning", result: null };
}

/** A disconnect ends planning immediately; board scores remain descriptive. */
export function forfeit(state: MatchState, loser: PlayerId): MatchState {
  if (state.phase === "ended") return state;
  const result = {
    ...score(state),
    winner: loser === 0 ? 1 : 0,
  } satisfies Score;
  return {
    ...state,
    phase: "ended",
    result,
    events: [{ type: "match-ended", result }],
  };
}
