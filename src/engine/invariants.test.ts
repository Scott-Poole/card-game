import { assert, expect, test } from "vitest";

import {
  commit,
  createMatch,
  playerView,
  resolve,
  stage,
  type CardDefinition,
  type EngineError,
  type MatchState,
  type Play,
  type Result,
} from "./index.js";

// The engine tsconfig excludes platform globals; Vitest runs on Node.
declare function structuredClone<T>(value: T): T;

const players = [0, 1] as const;
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const rejected = new Set<EngineError>();
test.each(Array.from({ length: 200 }, (_, seed) => seed))(
  "preserves match invariants for seed %i",
  (seed) => {
    let rng = seed + 1;
    const pick = (bound: number) => {
      rng ^= rng << 13;
      rng ^= rng >>> 17;
      rng ^= rng << 5;
      return (rng >>> 0) % bound;
    };
    const deck = (id: number): CardDefinition[] =>
      Array.from({ length: 18 }, (_, i) => ({
        id: `player-${String(id)}-card-${String(i)}-end`,
        name: `Figure ${String(i)}`,
        cost: i % 7,
        power: pick(13),
      }));
    const decks: [CardDefinition[], CardDefinition[]] = [deck(0), deck(1)];
    let state = createMatch(seed, decks);
    const check = () => {
      assert.equal(state.energy, state.turn);
      for (const id of players) {
        const player = state.players[id];
        assert.deepEqual(
          [...player.hand, ...player.deck, ...player.lanes.flat()]
            .map((c) => c.id)
            .sort(),
          decks[id].map((c) => c.id).sort(),
        );
        assert.ok(player.lanes.every((lane) => lane.length <= 4));
        const cost = player.staged.reduce((sum, play) => {
          const card = player.hand.find((c) => c.id === play.cardId);
          assert.ok(card);
          return sum + card.cost;
        }, 0);
        assert.ok(cost <= state.energy);
        const view = JSON.stringify(playerView(state, id));
        const opponent = state.players[id === 0 ? 1 : 0];
        for (const card of [...opponent.hand, ...opponent.deck])
          assert.ok(!view.includes(card.id));
        for (const play of opponent.staged)
          assert.ok(!view.includes(play.cardId));
      }
    };
    const action = (run: () => Result<MatchState>, error?: EngineError) => {
      const before = structuredClone(state);
      const result = run();
      if (error !== undefined) expect(result).toEqual({ ok: false, error });
      if (result.ok) state = result.value;
      else {
        rejected.add(result.error);
        expect(state).toEqual(before);
      }
      check();
    };
    check();
    let resolutions = 0;
    while (state.phase === "planning" && resolutions < 7) {
      expect(state.turn).toBe(resolutions + 1);
      for (const id of players) {
        const hand = state.players[id].hand;
        const card = hand[pick(hand.length)];
        if (card) {
          action(
            () => stage(state, id, [{ cardId: card.id, lane: 3 + pick(4) }]),
            "unknown-lane",
          );
          const openLane = state.players[id].lanes.findIndex(
            (l) => l.length < 4,
          );
          const play = { cardId: card.id, lane: openLane };
          if (openLane >= 0)
            action(() => stage(state, id, [play, play]), "duplicate-card");
        }
        const expensive = hand.find((c) => c.cost > state.energy);
        if (expensive && (state.players[id].lanes[0]?.length ?? 0) < 4)
          action(
            () => stage(state, id, [{ cardId: expensive.id, lane: 0 }]),
            "overspend",
          );
        const lane = pick(3);
        const overfill = hand.slice(
          0,
          5 - (state.players[id].lanes[lane]?.length ?? 0),
        );
        if (overfill.length + (state.players[id].lanes[lane]?.length ?? 0) > 4)
          action(
            () =>
              stage(
                state,
                id,
                overfill.map((c) => ({ cardId: c.id, lane })),
              ),
            "full-lane",
          );
        const plays: Play[] = [];
        // Incremental candidates retain a random legal subset when a candidate fails.
        for (const c of hand) {
          if (pick(3) === 0) continue;
          const candidate = [...plays, { cardId: c.id, lane: pick(3) }];
          action(() => stage(state, id, candidate));
          if (state.players[id].staged.length === candidate.length)
            plays.push({
              cardId: c.id,
              lane: candidate[candidate.length - 1]?.lane ?? 0,
            });
        }
        action(() => commit(state, id));
        action(() => commit(state, id), "already-committed");
        action(() => stage(state, id, []), "already-committed");
      }
      state = unwrap(resolve(state)).state;
      resolutions++;
      check();
      expect(state.phase).toBe(resolutions === 6 ? "ended" : "planning");
    }
    expect(resolutions).toBe(6);
    if (state.phase !== "ended") throw new Error("Match did not end");
    const totals = state.players.map((p) =>
      p.lanes.map((lane) => lane.reduce((sum, c) => sum + c.power, 0)),
    );
    const wins = [0, 0];
    for (let lane = 0; lane < 3; lane++) {
      const difference = (totals[0]?.[lane] ?? 0) - (totals[1]?.[lane] ?? 0);
      const winner = difference === 0 ? null : difference > 0 ? 0 : 1;
      expect(state.result.lanes[lane]).toBe(winner);
      if (winner !== null) wins[winner] = (wins[winner] ?? 0) + 1;
    }
    const power = totals.map((lanes) => lanes.reduce((sum, n) => sum + n, 0));
    expect(state.result.power).toEqual(power);
    const margin =
      (wins[0] ?? 0) - (wins[1] ?? 0) || (power[0] ?? 0) - (power[1] ?? 0);
    expect(state.result.winner).toBe(margin === 0 ? null : margin > 0 ? 0 : 1);
    action(() => stage(state, 0, []), "wrong-phase");
    action(() => commit(state, 1), "wrong-phase");
  },
);

test("seed corpus exercises every requested rejection", () => {
  for (const error of [
    "unknown-lane",
    "duplicate-card",
    "overspend",
    "full-lane",
    "already-committed",
    "wrong-phase",
  ] satisfies EngineError[])
    expect(rejected.has(error)).toBe(true);
});
