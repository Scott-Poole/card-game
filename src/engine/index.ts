const LANE_IDS = [0, 1, 2];
const LANE_CAPACITY = 4;
const OPENING_HAND = 3;
const TURN_LIMIT = 6;

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
export interface MatchState {
  readonly turn: number;
  readonly energy: number;
  readonly rng: number;
  readonly players: readonly [PlayerState, PlayerState];
  readonly phase: "planning" | "ended";
  readonly result: Score | null;
}
export type EngineError =
  | "card-not-in-hand"
  | "duplicate-card"
  | "overspend"
  | "full-lane"
  | "unknown-lane"
  | "wrong-phase"
  | "already-committed";
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
/** Card IDs must be unique within each supplied deck.
 * Seeds normalize to uint32. RNG consumption: player 0 shuffle, player 1
 * shuffle, then one sample for each tied initiative. Replay uses this ruleset. */
export function createMatch(
  seed: number,
  decks: readonly [readonly CardDefinition[], readonly CardDefinition[]],
): MatchState {
  let rng = seed >>> 0;
  function player(deck: readonly CardDefinition[]): PlayerState {
    const cards = deck.map((card) => ({ ...card }));
    for (let i = cards.length - 1; i > 0; i--) {
      rng = random(rng);
      const j = Math.floor((rng / 4294967296) * (i + 1));
      const a = cards[i];
      const b = cards[j];
      // Both indices are inside the dense copied deck.
      if (a && b) {
        cards[i] = b;
        cards[j] = a;
      }
    }
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
  return { turn: 1, energy: 1, rng, players, phase: "planning", result: null };
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
  if (state.phase !== "planning") return { ok: false, error: "wrong-phase" };
  const player = state.players[id];
  if (player.committed) return { ok: false, error: "already-committed" };
  const seen = new Set<string>();
  const counts = player.lanes.map((l) => l.length);
  let cost = 0;
  for (const play of plays) {
    if (
      !Number.isInteger(play.lane) ||
      play.lane < 0 ||
      play.lane >= LANE_IDS.length
    )
      return { ok: false, error: "unknown-lane" };
    if (seen.has(play.cardId)) return { ok: false, error: "duplicate-card" };
    seen.add(play.cardId);
    const card = player.hand.find((c) => c.id === play.cardId);
    if (!card) return { ok: false, error: "card-not-in-hand" };
    cost += card.cost;
    const count = (counts[play.lane] ?? 0) + 1;
    counts[play.lane] = count;
    if (count > LANE_CAPACITY) return { ok: false, error: "full-lane" };
  }
  if (cost > state.energy) return { ok: false, error: "overspend" };
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
export function resolve(state: MatchState): Result<{
  readonly state: MatchState;
  readonly events: readonly MatchEvent[];
}> {
  if (state.phase !== "planning" || !state.players.every((p) => p.committed))
    return { ok: false, error: "wrong-phase" };
  let rng = state.rng;
  let first = score(state).winner;
  if (first === null) {
    rng = random(rng);
    first = rng < 2147483648 ? 0 : 1;
  }
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
  return { ok: true, value: { state: next, events } };
}
