import { expect, test } from "vitest";
import { shuffle } from "./index.ts";

test("shuffles from scripted indices without mutating the input", () => {
  const cards = Object.freeze(
    ["a", "b", "c", "d"].map((id) => ({ id, name: id, cost: 1, power: 1 })),
  );
  const indices = [1, 0, 1];
  const bounds: number[] = [];
  const result = shuffle(cards, (bound) => {
    bounds.push(bound);
    const index = indices.shift();
    if (index === undefined) throw new Error("Unexpected random sample");
    return index;
  });
  expect(result.map((card) => card.id)).toEqual(["c", "d", "a", "b"]);
  expect(cards.map((card) => card.id)).toEqual(["a", "b", "c", "d"]);
  expect(bounds).toEqual([4, 3, 2]);
});
