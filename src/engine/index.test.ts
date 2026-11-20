import {
  opponentOf,
  type LocationDefinition,
  type PlayerId,
} from "../rules/index.ts";
import { testLocations } from "./locations.test-support.ts";
import { expect, test } from "vitest";
import {
  applyAction,
  commit,
  createMatch,
  playerView,
  resolve,
  stage,
  type CardDefinition,
  type MatchState,
  type Play,
  type PlayerAction,
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
  let next = unwrap(stage(state, 0, a));
  next = unwrap(stage(next, 1, b));
  next = unwrap(commit(next, 0));
  next = unwrap(commit(next, 1));
  return unwrap(resolve(next));
}
function play(state: MatchState, id: 0 | 1, lane: number): Play[] {
  const card = state.players[id].hand[0];
  return card ? [{ cardId: card.id, lane }] : [];
}

test("creates a seeded match with three opening cards and one energy", () => {
  const state = createMatch(42, [deck(), deck()], testLocations);
  expect(state.players.map((p) => [p.hand.length, p.deck.length])).toEqual([
    [3, 9],
    [3, 9],
  ]);
  expect(state.energy).toBe(1);
  expect(state).toEqual(createMatch(42, [deck(), deck()], testLocations));
  expect(state.players[0]).not.toEqual(
    createMatch(43, [deck(), deck()], testLocations).players[0],
  );
});

test.each([0, 1, 2, 3, 4, 12])(
  "draws once on later turns, including an exhausted deck of %i",
  (size) => {
    let state = createMatch(
      1,
      [deck(1, 0, size), deck(1, 0, size)],
      testLocations,
    );
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
    const state = createMatch(42, [deck(), deck()], testLocations);
    const before = JSON.stringify(state);
    expect(stage(state, 0, plays)).toEqual({ ok: false, error });
    expect(JSON.stringify(state)).toEqual(before);
  },
);

test("rejects duplicate cards and overspend; replacing staging refunds the old plays", () => {
  const state = createMatch(42, [deck(1, 1), deck()], testLocations);
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
  const initial = createMatch(42, [deck(), deck()], testLocations);
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
  let state = createMatch(42, [deck(), deck()], testLocations);
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

test("lane-capacity rejects a card past the limit, counting revealed cards", () => {
  const base = createMatch(42, [deck(), deck()], testLocations);
  const [first, ...rest] = base.locations;
  if (!first) throw new Error("Missing location");
  let state: MatchState = {
    ...base,
    locations: [
      {
        ...first,
        text: "Each player may reveal at most 2 cards here.",
        effect: { kind: "lane-capacity", limit: 2 },
      },
      ...rest,
    ],
  };
  const stageIn = (s: MatchState, id: 0 | 1, lane: number, count: number) =>
    stage(
      s,
      id,
      s.players[id].hand.slice(0, count).map((c) => ({ cardId: c.id, lane })),
    );
  // Cost-0 cards: only the lane limit constrains staging. Seat 0 reveals one.
  state = turn(state, play(state, 0, 0)).state;
  expect(stageIn(state, 0, 0, 2)).toEqual({ ok: false, error: "full-lane" });
  expect(stageIn(state, 0, 0, 1).ok).toBe(true);
  expect(stageIn(state, 0, 1, 3).ok).toBe(true);
  expect(stageIn(state, 1, 0, 2).ok).toBe(true);
  expect(stageIn(state, 1, 0, 3)).toEqual({ ok: false, error: "full-lane" });
});

interface RevealOrderCase {
  a: number[];
  b: number[];
  ap: number;
  bp: number;
  first: PlayerId;
}
test.each([
  { a: [0, 1], b: [2, 2], ap: 1, bp: 9, first: 0 },
  { a: [0, 0], b: [1, 1], ap: 1, bp: 9, first: 1 },
] satisfies RevealOrderCase[])(
  "reveal order uses lane wins then total power: %j",
  ({ a, b, ap, bp, first }) => {
    let state = createMatch(42, [deck(ap), deck(bp)], testLocations);
    for (let i = 0; i < 2; i++)
      state = turn(
        state,
        play(state, 0, a[i] ?? 0),
        play(state, 1, b[i] ?? 0),
      ).state;
    expect(playerView(state, 0).revealFirst).toBe(first);
    expect(playerView(state, 1).revealFirst).toBe(first);
    const events = turn(state, play(state, 0, 2), play(state, 1, 2)).events;
    expect(
      events.filter((e) => e.type === "card-revealed").map((e) => e.player),
    ).toEqual([first, opponentOf(first)]);
  },
);

test("a tied board's seeded flip can pick either player and is reproducible", () => {
  const firsts = new Set<number | null>();
  for (let seed = 0; seed < 20; seed++) {
    const state = createMatch(seed, [deck(), deck()], testLocations);
    const a = play(state, 0, 0);
    const b = play(state, 1, 0);
    const result = turn(state, a, b);
    expect(result).toEqual(turn(state, a, b));
    const event = result.events[0];
    if (event?.type !== "card-revealed") throw new Error("Expected a reveal");
    expect(playerView(state, 0).revealFirst).toBe(event.player);
    firsts.add(event.player);
  }
  expect([...firsts].sort()).toEqual([0, 1]);
});

// Golden vector: the flip takes exactly one sample after setup (shuffles and
// location draws), as before reveal order was exposed in the view.
test("a tied turn 1 draws one flip sample and pins the seeded replay", () => {
  const initial = createMatch(42, [deck(), deck()], testLocations);
  expect(playerView(initial, 0).revealFirst).toBe(1);
  expect(initial.rng).toBe(4050676697);
  const resolved = turn(initial, play(initial, 0, 0), play(initial, 1, 0));
  expect(resolved.state.rng).toBe(3528319844);
  expect(
    resolved.events.flatMap((e) =>
      e.type === "card-revealed" ? [e.player] : [],
    ),
  ).toEqual([1, 0]);
});

test("every view names the player who reveals first, before and after staging, matching resolution", () => {
  // Mixed powers so the lead changes hands as well as tying.
  const varied = (reverse: boolean) =>
    deck().map((card, i) => ({
      ...card,
      power: reverse ? 3 - (i % 3) : 1 + (i % 3),
    }));
  let decidedLanes = 0;
  let tied = 0;
  for (const seed of [0, 1, 2, 3, 4, 5]) {
    let state = createMatch(seed, [varied(false), varied(true)], testLocations);
    for (let i = 0; i < 6; i++) {
      const first = playerView(state, 0).revealFirst;
      expect(playerView(state, 1).revealFirst).toBe(first);
      const a = play(state, 0, i % 3);
      const b = play(state, 1, (2 * i) % 3);
      const staged = unwrap(stage(unwrap(stage(state, 0, a)), 1, b));
      expect(playerView(staged, 0).revealFirst).toBe(first);
      const resolved = turn(state, a, b);
      const players = resolved.events.flatMap((e) =>
        e.type === "card-revealed" ? [e.player] : [],
      );
      // Cards reveal in order: the first player's, then the other's.
      if (players.length === 2) expect(players[0]).toBe(first);
      const total = (id: 0 | 1) =>
        state.players[id].lanes.map((l) => l.reduce((n, c) => n + c.power, 0));
      const lanes = total(0).map((n, lane) =>
        Math.sign(n - (total(1)[lane] ?? 0)),
      );
      if (lanes.some((n) => n !== 0)) decidedLanes++;
      else tied++;
      state = resolved.state;
    }
  }
  expect(decidedLanes).toBeGreaterThan(0);
  expect(tied).toBeGreaterThan(0);
});

test.each([
  { a: [0, 1], b: [2, 2], ap: 1, bp: 9, lanes: [0, 0, 1], winner: 0 },
  { a: [0, 0], b: [1, 1], ap: 1, bp: 9, lanes: [0, 1, null], winner: 1 },
  { a: [0, 0], b: [1, 1], ap: 1, bp: 1, lanes: [0, 1, null], winner: null },
])(
  "scores a complete six-turn public-API match: %j",
  ({ a, b, ap, bp, lanes, winner }) => {
    function run() {
      let state = createMatch(42, [deck(ap), deck(bp)], testLocations);
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
  let state = createMatch(42, [deck(2, 1), deck()], testLocations);
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

test.each([0, 1])(
  "turn 2 has exactly two energy after spending %i on turn 1",
  (spent) => {
    let state = createMatch(42, [deck(1, 1), deck()], testLocations);
    state = turn(state, spent ? play(state, 0, 0) : []).state;
    const plays = state.players[0].hand
      .slice(0, 3)
      .map((c) => ({ cardId: c.id, lane: 0 }));
    expect(stage(state, 0, plays)).toEqual({ ok: false, error: "overspend" });
    expect(stage(state, 0, plays.slice(0, 2)).ok).toBe(true);
  },
);

test("equal non-empty lanes are tied", () => {
  let state = createMatch(42, [deck(3), deck(3)], testLocations);
  state = turn(state, play(state, 0, 0), play(state, 1, 0)).state;
  for (let n = 1; n < 6; n++) state = turn(state).state;
  expect(state.result).toEqual({
    lanes: [null, null, null],
    power: [3, 3],
    winner: null,
  });
});

test("caller changes to deck definitions do not change a created match", () => {
  const cards = deck();
  const state = createMatch(42, [cards, cards], testLocations);
  const before = JSON.stringify(state);
  Object.assign(cards[0] ?? {}, { power: 999 });
  expect(JSON.stringify(state)).toBe(before);
});

test("draws the next shuffled card for each player and conserves the deck", () => {
  const state = createMatch(42, [deck(), deck(7)], testLocations);
  const next = turn(state).state;
  for (const id of [0, 1] satisfies (0 | 1)[]) {
    expect(next.players[id].hand).toEqual([
      ...state.players[id].hand,
      ...state.players[id].deck.slice(0, 1),
    ]);
    expect(next.players[id].deck).toEqual(state.players[id].deck.slice(1));
    expect(next.players[id].hand.length + next.players[id].deck.length).toBe(
      12,
    );
  }
});

test("plays cards on every turn with real energy costs in a reproducible full match", () => {
  function run() {
    let state = createMatch(42, [deck(2, 1), deck(1, 1)], testLocations);
    const history = [];
    for (let n = 1; n <= 6; n++) {
      const lane = (n - 1) % 3;
      const result = turn(state, play(state, 0, lane), play(state, 1, lane));
      expect(
        result.events.filter((e) => e.type === "card-revealed"),
      ).toHaveLength(2);
      history.push(result);
      state = result.state;
    }
    expect(state.result).toEqual({
      lanes: [0, 0, 0],
      power: [12, 6],
      winner: 0,
    });
    return history;
  }
  expect(run()).toEqual(run());
});

test("persists RNG across non-empty ties and leaves it alone on a lane lead", () => {
  const initial = createMatch(42, [deck(), deck()], testLocations);
  const tied = turn(initial, play(initial, 0, 0), play(initial, 1, 0));
  expect(tied.state.rng).not.toBe(initial.rng);
  const next = turn(tied.state, play(tied.state, 0, 1), play(tied.state, 1, 1));
  expect(next.state.rng).not.toBe(tied.state.rng);
  expect(next).toEqual(
    turn(tied.state, play(tied.state, 0, 1), play(tied.state, 1, 1)),
  );
  const lead = turn(initial, play(initial, 0, 0)).state;
  expect(turn(lead).state.rng).toBe(lead.rng);
});

test("staging owns a copy of the caller play list", () => {
  const initial = createMatch(42, [deck(), deck()], testLocations);
  const plays = play(initial, 0, 0);
  const state = unwrap(stage(initial, 0, plays));
  plays.splice(0, plays.length);
  expect(state.players[0].staged).toEqual(play(initial, 0, 0));
});

test.each([
  [2 ** 32 + 5, 5],
  [-1, 4294967295],
  [NaN, 0],
])("normalizes seed %s to uint32 %s", (seed, normalized) => {
  expect(createMatch(seed, [deck(), deck()], testLocations)).toEqual(
    createMatch(normalized, [deck(), deck()], testLocations),
  );
});

// Golden vector: the RNG state follows both deck shuffles and the location draw.
test("preserves the seeded replay deck order and RNG state", () => {
  const state = createMatch(42, [deck(), deck()], testLocations);
  expect(state.rng).toBe(4050676697);
  expect(
    state.players.map((player) => ({
      hand: player.hand.map((card) => card.id),
      deck: player.deck.map((card) => card.id),
    })),
  ).toEqual([
    {
      hand: ["4", "1", "9"],
      deck: ["7", "6", "8", "10", "11", "2", "5", "0", "3"],
    },
    {
      hand: ["2", "6", "1"],
      deck: ["3", "4", "9", "10", "0", "11", "8", "7", "5"],
    },
  ]);
});

test("applying the second commit resolves atomically while the first stays planning", () => {
  const initial = createMatch(42, [deck(), deck()], testLocations);
  const before = JSON.stringify(initial);
  const first = unwrap(applyAction(initial, 1, { type: "commit" }));
  expect(first.phase).toBe("planning");
  expect(first.turn).toBe(1);
  expect(first.players.map((p) => p.committed)).toEqual([false, true]);
  expect(applyAction(first, 1, { type: "commit" })).toEqual({
    ok: false,
    error: "already-committed",
  });
  const firstBefore = JSON.stringify(first);
  expect(applyAction(first, 1, { type: "stage", plays: [] })).toEqual({
    ok: false,
    error: "already-committed",
  });
  const second = unwrap(applyAction(first, 0, { type: "commit" }));
  expect(JSON.stringify(first)).toBe(firstBefore);
  expect(second.turn).toBe(2);
  expect(second.events).toEqual([{ type: "turn-ended", turn: 1 }]);
  expect(second.players.map((p) => p.committed)).toEqual([false, false]);
  expect(JSON.stringify(initial)).toBe(before);
  expect(first.players[1].committed).toBe(true);
});

test("action-only six-turn replay matches the scripted low-level match and events", () => {
  let state = createMatch(42, [deck(2, 1), deck(1, 1)], testLocations);
  let reference = createMatch(42, [deck(2, 1), deck(1, 1)], testLocations);
  for (let n = 0; n < 6; n++) {
    const a = play(state, 0, n % 3);
    const b = play(state, 1, n % 3);
    const expected = turn(reference, a, b);
    state = unwrap(applyAction(state, 0, { type: "stage", plays: a }));
    state = unwrap(applyAction(state, 1, { type: "stage", plays: b }));
    state = unwrap(applyAction(state, 0, { type: "commit" }));
    state = unwrap(applyAction(state, 1, { type: "commit" }));
    expect(state).toEqual(expected.state);
    expect(state.events).toEqual(expected.events);
    for (const id of [0, 1] satisfies (0 | 1)[]) {
      expect(
        JSON.stringify({ type: "state", view: playerView(state, id) }),
      ).toBe(
        JSON.stringify({ type: "state", view: playerView(expected.state, id) }),
      );
    }
    reference = expected.state;
  }
  expect(state.phase).toBe("ended");
  expect(state.result).toEqual({
    lanes: [0, 0, 0],
    power: [12, 6],
    winner: 0,
  });
  for (const action of [
    { type: "stage", plays: [] },
    { type: "commit" },
  ] satisfies PlayerAction[]) {
    expect(applyAction(state, 0, action)).toEqual({
      ok: false,
      error: "wrong-phase",
    });
  }
});

test("invalid action preserves the state and existing staging error", () => {
  const state = createMatch(42, [deck(), deck()], testLocations);
  const before = JSON.stringify(state);
  expect(
    applyAction(state, 0, {
      type: "stage",
      plays: [{ cardId: "absent", lane: 0 }],
    }),
  ).toEqual({ ok: false, error: "card-not-in-hand" });
  expect(JSON.stringify(state)).toBe(before);
});

test("draws three distinct locations from the pool, fixed for the match", () => {
  const state = createMatch(42, [deck(), deck()], testLocations);
  expect(state.locations).toHaveLength(3);
  expect(new Set(state.locations.map((l) => l.id)).size).toBe(3);
  for (const location of state.locations)
    expect(testLocations).toContainEqual(location);
  expect(state.locations).toEqual(
    createMatch(42, [deck(), deck()], testLocations).locations,
  );
  const next = turn(state, play(state, 0, 0), play(state, 1, 0)).state;
  expect(next.locations).toEqual(state.locations);
});

test("different seeds draw different location selections", () => {
  const selections = new Set<string>();
  for (let seed = 0; seed < 30; seed++)
    selections.add(
      createMatch(seed, [deck(), deck()], testLocations)
        .locations.map((l) => l.id)
        .join(","),
    );
  expect(selections.size).toBeGreaterThan(1);
});

test("draws the pinned locations for a seed, in lane order", () => {
  expect(
    createMatch(42, [deck(), deck()], testLocations).locations.map((l) => l.id),
  ).toEqual(["place-3", "place-2", "place-5"]);
});

test("pool size never moves the rng stream that follows the draw", () => {
  const extra: LocationDefinition = {
    id: "extra",
    name: "Extra",
    text: "No effect for now.",
    effect: { kind: "none" },
  };
  const small = createMatch(42, [deck(), deck()], testLocations);
  const large = createMatch(42, [deck(), deck()], [...testLocations, extra]);
  expect(large.rng).toBe(small.rng);
});

test("rejects a location pool with duplicate ids", () => {
  const duplicated = testLocations.map((location, index) =>
    index === 1 ? { ...location, id: testLocations[0]?.id ?? "" } : location,
  );
  expect(() => createMatch(42, [deck(), deck()], duplicated)).toThrow(
    "unique id",
  );
});

test("rejects a location pool too small to fill the lanes", () => {
  expect(() =>
    createMatch(42, [deck(), deck()], testLocations.slice(0, 2)),
  ).toThrow("location pool");
});

test("power-per-card flips a lane winner, the reveal order and the match winner relative to printed power", () => {
  const boosted = (
    effect: LocationDefinition["effect"],
    text: string,
  ): MatchState => {
    const state = createMatch(7, [deck(3), deck(1)], testLocations);
    const [first, ...rest] = state.locations;
    if (!first) throw new Error("Missing location");
    return { ...state, locations: [{ ...first, text, effect }, ...rest] };
  };
  // Seat 0 reveals one 3-power card in lane 0; seat 1 reveals two 1-power cards.
  const playOut = (start: MatchState) => {
    const hand1 = start.players[1].hand;
    let state = turn(
      start,
      play(start, 0, 0),
      hand1.slice(0, 2).map((card) => ({ cardId: card.id, lane: 0 })),
    ).state;
    const revealFirst = playerView(state, 0).revealFirst;
    // Branch: if turn 2 staged a card each, the first reveal event follows
    // the order. The main line stages nothing, so totals stay as set above.
    const branch = turn(state, play(state, 0, 1), play(state, 1, 2));
    const firstReveal = branch.events.find((e) => e.type === "card-revealed");
    expect(firstReveal?.type === "card-revealed" && firstReveal.player).toBe(
      revealFirst,
    );
    for (let t = 2; t <= 6; t++) state = turn(state).state;
    return { state, revealFirst };
  };
  const printed = playOut(boosted({ kind: "none" }, "No effect for now."));
  expect(printed.state.result?.lanes).toEqual([0, null, null]);
  expect(printed.state.result?.power).toEqual([3, 2]);
  expect(printed.state.result?.winner).toBe(0);
  expect(printed.revealFirst).toBe(0);

  const boostedMatch = playOut(
    boosted(
      { kind: "power-per-card", amount: 2 },
      "Each card you reveal here adds 2 power.",
    ),
  );
  expect(boostedMatch.state.result?.lanes).toEqual([1, null, null]);
  expect(boostedMatch.state.result?.power).toEqual([5, 6]);
  expect(boostedMatch.state.result?.winner).toBe(1);
  expect(boostedMatch.revealFirst).toBe(1);
});
