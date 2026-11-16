import { expect, test } from "vitest";
import { checkStaging, legalPlays } from "../rules/index.ts";
import { createMatch, playerView, stage, commit, resolve } from "./index.ts";

test("shared staging checks agree with the engine across seeded mid-turn views", () => {
  for (let seed = 1; seed <= 100; seed++) {
    let rng = seed;
    const pick = (n: number) => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return rng % n;
    };
    const deck = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: String(i),
      cost: i % 4,
      power: i,
    }));
    let state = createMatch(seed, [deck, deck]);
    while (state.phase === "planning") {
      for (const id of [0, 1] as const) {
        for (let trial = 0; trial < 30; trial++) {
          const view = playerView(state, id);
          const plays = Array.from({ length: pick(6) }, () => ({
            cardId: String(pick(14)),
            lane: pick(6) - 1,
          }));
          const checked = checkStaging(view, plays);
          const result = stage(state, id, plays);
          expect(result.ok ? { ok: true } : result).toEqual(checked);
          for (const card of view.own.hand)
            for (let lane = 0; lane < 3; lane++) {
              const play = { cardId: card.id, lane };
              expect(
                legalPlays(view).some(
                  (p) => p.cardId === card.id && p.lane === lane,
                ),
              ).toBe(checkStaging(view, [...view.own.staged, play]).ok);
            }
          if (result.ok) state = result.value;
        }
        const result = commit(state, id);
        if (!result.ok) throw new Error(result.error);
        state = result.value;
      }
      const result = resolve(state);
      if (!result.ok) throw new Error(result.error);
      state = result.value.state;
    }
    expect(checkStaging(playerView(state, 0), [])).toEqual({
      ok: false,
      error: "wrong-phase",
    });
  }
});
