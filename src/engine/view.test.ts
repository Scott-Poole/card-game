import { testLocations } from "./locations.test-support.ts";
import { opponentOf } from "../rules/index.ts";
import { expect, test } from "vitest";
import {
  commit,
  forfeit,
  type Score,
  createMatch,
  resolve,
  stage,
  playerView,
  type Result,
  type MatchState,
  type PlayerId,
} from "./index.js";

const card = (id: string) => ({ id, name: id, cost: 1, power: 2 });
const state: MatchState = {
  turn: 3,
  energy: 3,
  rng: 1987654321,
  locations: testLocations.slice(0, 3),
  phase: "planning",
  result: null,
  events: [],
  players: [player(0), player(1)],
};
function player(id: PlayerId) {
  return {
    hand: [card(`hand-secret-${String(id)}`)],
    deck: [card(`deck-secret-${String(id)}`), card(`deck-tail-${String(id)}`)],
    staged: [{ cardId: `hand-secret-${String(id)}`, lane: id }],
    lanes: [[card(`board-${String(id)}`)], [], []],
    zones: {
      destroyed: [card(`destroyed-${String(id)}`)],
      discarded: [card(`discarded-${String(id)}`)],
      banished: [],
    },
    committed: false,
  };
}

test.each([0, 1] satisfies PlayerId[])(
  "player %i sees only permitted information before and after opponent commits",
  (id) => {
    const opponent = opponentOf(id);
    for (const committed of [false, true]) {
      const other = { ...state.players[opponent], committed };
      const current: MatchState = {
        ...state,
        players:
          id === 0 ? [state.players[0], other] : [other, state.players[1]],
      };
      const view = playerView(current, id);
      expect(view.own.hand).toEqual(state.players[id].hand);
      expect(view.own.staged).toEqual(state.players[id].staged);
      expect(view.own.lanes).toEqual(state.players[id].lanes);
      expect(view.opponent).toEqual({
        handSize: 1,
        deckSize: 2,
        committed,
        lanes: state.players[opponent].lanes,
        zones: state.players[opponent].zones,
      });
      expect(view.own.deckSize).toBe(2);
      const json = JSON.stringify(view);
      for (const secret of [
        `hand-secret-${String(opponent)}`,
        "deck-secret-0",
        "deck-secret-1",
        "deck-tail-0",
        "deck-tail-1",
        String(state.rng),
      ])
        expect(json).not.toContain(secret);
      expect(view).toMatchObject({
        turn: 3,
        energy: 3,
        phase: "planning",
        result: null,
      });
    }
  },
);

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
test("views retain ordered resolved events through staging and commit, and carry the final result", () => {
  let match = createMatch(
    42,
    [[card("a"), card("c")], [card("b")]],
    testLocations,
  );
  expect(playerView(match, 0).events).toEqual([]);
  for (let turn = 1; turn <= 6; turn++) {
    const previous = playerView(match, 0).events;
    if (turn === 2) match = unwrap(stage(match, 0, [{ cardId: "c", lane: 0 }]));
    expect(playerView(match, 0).events).toEqual(previous);
    if (turn === 1) {
      match = unwrap(stage(match, 0, [{ cardId: "a", lane: 0 }]));
      match = unwrap(stage(match, 1, [{ cardId: "b", lane: 1 }]));
    }
    match = unwrap(commit(match, 0));
    expect(playerView(match, 1).events).toEqual(previous);
    match = unwrap(commit(match, 1));
    const resolved = unwrap(resolve(match));
    match = resolved.state;
    for (const id of [0, 1] satisfies PlayerId[])
      expect(playerView(match, id).events).toEqual(resolved.events);
    if (turn > 2 && turn < 6)
      expect(playerView(match, 0).events).toEqual([
        { type: "turn-ended", turn },
      ]);
    if (turn === 1) {
      expect(playerView(match, 1).events).toEqual([
        { type: "card-revealed", player: 0, lane: 0, card: card("a") },
        { type: "card-revealed", player: 1, lane: 1, card: card("b") },
        { type: "turn-ended", turn: 1 },
      ]);
      expect(resolved.events[2]).toEqual({ type: "turn-ended", turn: 1 });
    }
  }
  for (const id of [0, 1] satisfies PlayerId[])
    expect(playerView(match, id).result).toEqual({
      lanes: [0, 1, null],
      power: [4, 2],
      winner: 0,
    });
});
test("views swap own and opponent while preserving shared match information", () => {
  const a = playerView(state, 0);
  const b = playerView(state, 1);
  expect(a.own).toEqual({
    deckSize: b.opponent.deckSize,
    committed: b.opponent.committed,
    lanes: b.opponent.lanes,
    zones: b.opponent.zones,
    hand: state.players[0].hand,
    staged: state.players[0].staged,
  });
  expect(b.own).toEqual({
    deckSize: a.opponent.deckSize,
    committed: a.opponent.committed,
    lanes: a.opponent.lanes,
    zones: a.opponent.zones,
    hand: state.players[1].hand,
    staged: state.players[1].staged,
  });
  expect(a.player).toBe(0);
  expect(b.player).toBe(1);
  expect({ ...a, player: b.player, own: b.own, opponent: b.opponent }).toEqual(
    b,
  );
});

test("phase narrows planning and forfeited view results", () => {
  for (const loser of [0, 1] satisfies PlayerId[]) {
    for (const match of [state, forfeit(state, loser)]) {
      const view = playerView(match, 0);
      expect(view.phase).toBe(match.phase);
      expect(Object.keys(view)).toEqual([
        "player",
        "turn",
        "energy",
        "revealFirst",
        "locations",
        "own",
        "opponent",
        "events",
        "phase",
        "result",
      ]);
      if (view.phase === "planning") {
        const result: null = view.result;
        expect(result).toBeNull();
        expect(view.revealFirst).not.toBeNull();
      } else {
        expect(view.revealFirst).toBeNull();
        const result: Score = view.result;
        expect(result).toEqual({
          lanes: [null, null, null],
          power: [2, 2],
          winner: opponentOf(loser),
        });
      }
    }
  }
});

test("both players see the same three match locations in lane order", () => {
  const a = playerView(state, 0);
  const b = playerView(state, 1);
  expect(a.locations).toHaveLength(3);
  expect(a.locations).toEqual(state.locations);
  expect(b.locations).toEqual(state.locations);
});

test("off-board zones are face up: each player sees both players' full lists", () => {
  for (const id of [0, 1] satisfies PlayerId[]) {
    const view = playerView(state, id);
    const other = opponentOf(id);
    expect(view.own.zones).toEqual(state.players[id].zones);
    expect(view.opponent.zones).toEqual(state.players[other].zones);
    expect(view.opponent.zones.destroyed).toEqual([
      card(`destroyed-${String(other)}`),
    ]);
  }
});

test("a new match starts with every zone empty", () => {
  const match = createMatch(7, [[card("a")], [card("b")]], testLocations);
  for (const p of match.players)
    expect(p.zones).toEqual({ destroyed: [], discarded: [], banished: [] });
});
