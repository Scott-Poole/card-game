import { expect, test } from "vitest";
import {
  commit,
  createMatch,
  resolve,
  stage,
  type CardDefinition,
  type MatchState,
  type Play,
  type Result,
} from "./index.js";

const deck = (power = 1, cost = 0, size = 12): CardDefinition[] =>
  Array.from({ length: size }, (_, i) => ({
    id: String(i),
    name: `Figure ${String(i)}`,
    cost,
    power,
  }));
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
function turn(
  state: MatchState,
  a: readonly Play[] = [],
  b: readonly Play[] = [],
) {
  return unwrap(
    resolve(
      unwrap(
        commit(
          unwrap(commit(unwrap(stage(unwrap(stage(state, 0, a)), 1, b)), 0)),
          1,
        ),
      ),
    ),
  );
}
function play(state: MatchState, id: 0 | 1, lane: number): Play[] {
  const card = state.players[id].hand[0];
  return card ? [{ cardId: card.id, lane }] : [];
}

test("creates a seeded match with three opening cards and one energy", () => {
  const state = createMatch(42, [deck(), deck()]);
  expect(state.players.map((p) => [p.hand.length, p.deck.length])).toEqual([
    [3, 9],
    [3, 9],
  ]);
  expect(state.energy).toBe(1);
  expect(state).toEqual(createMatch(42, [deck(), deck()]));
  expect(state.players[0].hand).not.toEqual(
    createMatch(43, [deck(), deck()]).players[0].hand,
  );
});

test.each([0, 3, 4, 12])(
  "draws once on later turns, including an exhausted deck of %i",
  (size) => {
    let state = createMatch(1, [deck(1, 0, size), deck(1, 0, size)]);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(state.energy).toBe(n);
      expect(state.players[0].hand.length).toBe(Math.min(size, n + 2));
      state = turn(state).state;
    }
    expect(state.phase).toBe("ended");
    expect(state.turn).toBe(6);
  },
);

test.each([
  ["card-not-in-hand", [{ cardId: "absent", lane: 0 }]],
  ["unknown-lane", [{ cardId: "x", lane: -1 }]],
  ["unknown-lane", [{ cardId: "x", lane: 3 }]],
  ["unknown-lane", [{ cardId: "x", lane: 0.5 }]],
  ["unknown-lane", [{ cardId: "x", lane: NaN }]],
] satisfies [string, Play[]][])(
  "rejects %s without changing state",
  (error, plays) => {
    const state = createMatch(42, [deck(), deck()]);
    const before = JSON.stringify(state);
    expect(stage(state, 0, plays)).toEqual({ ok: false, error });
    expect(JSON.stringify(state)).toEqual(before);
  },
);

test("rejects duplicate cards and overspend; replacing staging refunds the old plays", () => {
  const state = createMatch(42, [deck(1, 1), deck()]);
  const plays = play(state, 0, 0);
  expect(stage(state, 0, [...plays, ...plays])).toEqual({
    ok: false,
    error: "duplicate-card",
  });
  const two = state.players[0].hand
    .slice(0, 2)
    .map((c) => ({ cardId: c.id, lane: 0 }));
  expect(stage(state, 0, two)).toEqual({ ok: false, error: "overspend" });
  const staged = unwrap(stage(state, 0, plays));
  expect(unwrap(stage(staged, 0, [])).players[0].staged).toEqual([]);
  expect(unwrap(stage(staged, 0, play(state, 0, 1))).players[0].staged).toEqual(
    play(state, 0, 1),
  );
  expect(state.players[0].staged).toEqual([]);
});

test("commit locks staging; resolution requires both commits and consumes no input state", () => {
  const initial = createMatch(42, [deck(), deck()]);
  const state = unwrap(commit(initial, 0));
  expect(stage(state, 0, [])).toEqual({
    ok: false,
    error: "already-committed",
  });
  expect(commit(state, 0)).toEqual({ ok: false, error: "already-committed" });
  for (const s of [initial, state])
    expect(resolve(s)).toEqual({ ok: false, error: "wrong-phase" });
  const ready = unwrap(commit(state, 1));
  const before = JSON.stringify(ready);
  expect(unwrap(resolve(ready)).state.turn).toBe(2);
  expect(JSON.stringify(ready)).toEqual(before);
});

test("lane capacity counts placed and newly staged cards", () => {
  let state = createMatch(42, [deck(), deck()]);
  for (let n = 0; n < 4; n++) state = turn(state, play(state, 0, 0)).state;
  expect(stage(state, 0, play(state, 0, 0))).toEqual({
    ok: false,
    error: "full-lane",
  });
  expect(
    stage(
      state,
      1,
      state.players[1].hand.slice(0, 5).map((c) => ({ cardId: c.id, lane: 1 })),
    ),
  ).toEqual({ ok: false, error: "full-lane" });
});

test.each([
  { a: [0, 1], b: [2, 2], ap: 1, bp: 9, first: 0 },
  { a: [0, 0], b: [1, 1], ap: 1, bp: 9, first: 1 },
])(
  "initiative uses lane wins then total power: %j",
  ({ a, b, ap, bp, first }) => {
    let state = createMatch(42, [deck(ap), deck(bp)]);
    for (let i = 0; i < 2; i++)
      state = turn(
        state,
        play(state, 0, a[i] ?? 0),
        play(state, 1, b[i] ?? 0),
      ).state;
    const events = turn(state, play(state, 0, 2), play(state, 1, 2)).events;
    expect(
      events.filter((e) => e.type === "card-revealed").map((e) => e.player),
    ).toEqual([first, first === 0 ? 1 : 0]);
  },
);

test("seeded initiative can pick either player and is reproducible", () => {
  const firsts = new Set<number>();
  for (let seed = 0; seed < 20; seed++) {
    const state = createMatch(seed, [deck(), deck()]);
    const a = play(state, 0, 0);
    const b = play(state, 1, 0);
    const result = turn(state, a, b);
    expect(result).toEqual(turn(state, a, b));
    const event = result.events[0];
    if (event?.type === "card-revealed") firsts.add(event.player);
  }
  expect([...firsts].sort()).toEqual([0, 1]);
});

test.each([
  { a: [0, 1], b: [2, 2], ap: 1, bp: 9, lanes: [0, 0, 1], winner: 0 },
  { a: [0, 0], b: [1, 1], ap: 1, bp: 9, lanes: [0, 1, null], winner: 1 },
  { a: [0, 0], b: [1, 1], ap: 1, bp: 1, lanes: [0, 1, null], winner: null },
])(
  "scores a complete six-turn public-API match: %j",
  ({ a, b, ap, bp, lanes, winner }) => {
    function run() {
      let state = createMatch(42, [deck(ap), deck(bp)]);
      const history = [];
      for (let n = 0; n < 6; n++) {
        const result = turn(
          state,
          n < 2 ? play(state, 0, a[n] ?? 0) : [],
          n < 2 ? play(state, 1, b[n] ?? 0) : [],
        );
        history.push(result);
        state = result.state;
      }
      expect(state.result).toEqual({ lanes, power: [2 * ap, 2 * bp], winner });
      expect(history[5]?.events).toEqual([
        { type: "turn-ended", turn: 6 },
        { type: "match-ended", result: state.result },
      ]);
      for (const action of [
        stage(state, 0, []),
        commit(state, 0),
        resolve(state),
      ])
        expect(action).toEqual({ ok: false, error: "wrong-phase" });
      return history;
    }
    expect(run()).toEqual(run());
  },
);

test("reveals each staged card in list order, removes it from hand, and resets energy", () => {
  let state = createMatch(42, [deck(2, 1), deck()]);
  state = turn(state).state;
  const plays = state.players[0].hand
    .slice(0, 2)
    .map((c) => ({ cardId: c.id, lane: 0 }));
  const before = JSON.stringify(state);
  const resolved = turn(state, plays);
  expect(
    resolved.events
      .filter((e) => e.type === "card-revealed")
      .map((e) => e.card.id),
  ).toEqual(plays.map((p) => p.cardId));
  expect(
    resolved.state.players[0].hand.some((c) =>
      plays.some((p) => p.cardId === c.id),
    ),
  ).toBe(false);
  expect(resolved.state.players[0].lanes[0]?.length).toBe(2);
  expect(resolved.state.players[0].staged).toEqual([]);
  expect(resolved.state.energy).toBe(3);
  expect(JSON.stringify(state)).toBe(before);
});
