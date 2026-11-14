import { expect, test } from "vitest";
import {
  commit,
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
  phase: "planning",
  result: null,
  events: [],
  players: [player(0), player(1)],
};
function player(id: PlayerId) {
  return {
    hand: [card(`hand-secret-${String(id)}`)],
    deck: [card(`deck-secret-${String(id)}`)],
    staged: [{ cardId: `hand-secret-${String(id)}`, lane: id }],
    lanes: [[card(`board-${String(id)}`)], [], []],
    committed: false,
  };
}

test.each([0, 1] satisfies PlayerId[])(
  "player %i sees only permitted information before and after opponent commits",
  (id) => {
    const opponent = id === 0 ? 1 : 0;
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
        deckSize: 1,
        committed,
        lanes: state.players[opponent].lanes,
      });
      expect(view.own.deckSize).toBe(1);
      const json = JSON.stringify(view);
      for (const secret of [
        `hand-secret-${String(opponent)}`,
        "deck-secret-0",
        "deck-secret-1",
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
  let match = createMatch(42, [[card("a")], [card("b")]]);
  expect(playerView(match, 0).events).toEqual([]);
  for (let turn = 1; turn <= 6; turn++) {
    if (turn === 1) {
      match = unwrap(stage(match, 0, [{ cardId: "a", lane: 0 }]));
      match = unwrap(stage(match, 1, [{ cardId: "b", lane: 1 }]));
    }
    const previous = playerView(match, 0).events;
    match = unwrap(commit(match, 0));
    expect(playerView(match, 1).events).toEqual(previous);
    match = unwrap(commit(match, 1));
    const resolved = unwrap(resolve(match));
    match = resolved.state;
    for (const id of [0, 1] satisfies PlayerId[])
      expect(playerView(match, id).events).toEqual(resolved.events);
    if (turn === 1) {
      expect(resolved.events).toHaveLength(3);
      expect(resolved.events.slice(0, 2).map((e) => e.type)).toEqual([
        "card-revealed",
        "card-revealed",
      ]);
      expect(resolved.events[2]).toEqual({ type: "turn-ended", turn: 1 });
    }
  }
  for (const id of [0, 1] satisfies PlayerId[])
    expect(playerView(match, id).result).toEqual({
      lanes: [0, 1, null],
      power: [2, 2],
      winner: null,
    });
});
test("views swap own and opponent while preserving shared match information", () => {
  const a = playerView(state, 0);
  const b = playerView(state, 1);
  expect(a.own).toEqual({
    ...b.opponent,
    hand: state.players[0].hand,
    staged: state.players[0].staged,
  });
  expect(b.own).toEqual({
    ...a.opponent,
    hand: state.players[1].hand,
    staged: state.players[1].staged,
  });
  expect({ ...a, own: b.own, opponent: b.opponent }).toEqual(b);
});
