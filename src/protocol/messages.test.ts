import { expect, it } from "vitest";
import { decodeServerMessage, decodeClientMessage } from "./messages.ts";

it("decodes a welcome message", () => {
  expect(decodeServerMessage('{"type":"welcome"}')).toEqual({
    ok: true,
    message: { type: "welcome" },
  });
});

it.each([
  ["object", { type: "welcome" }, { ok: true, message: { type: "welcome" } }],
  [
    "nested welcome string",
    JSON.stringify(JSON.stringify({ type: "welcome" })),
    { ok: false, error: "invalid-message" },
  ],
  ["wrong type", 42, { ok: false, error: "invalid-message" }],
  ["null", null, { ok: false, error: "invalid-message" }],
  ["missing fields", {}, { ok: false, error: "invalid-message" }],
  ["non-JSON", "{", { ok: false, error: "invalid-json" }],
  [
    "extra fields",
    '{"type":"welcome","extra":1}',
    { ok: false, error: "invalid-message" },
  ],
  ["unknown type", { type: "other" }, { ok: false, error: "invalid-message" }],
  ["JSON string", '"{}"', { ok: false, error: "invalid-message" }],
  ["array", [], { ok: false, error: "invalid-message" }],
])("server decoder: %s", (_name, input, expected) => {
  expect(decodeServerMessage(input)).toEqual(expected);
});

it.each([
  ["valid JSON", '{"type":"welcome"}', "unrecognized-message"],
  ["object", { type: "welcome" }, "unrecognized-message"],
  ["wrong type", 42, "unrecognized-message"],
  ["missing fields", {}, "unrecognized-message"],
  ["non-JSON", "{", "invalid-json"],
  ["extra fields", { type: "welcome", extra: true }, "unrecognized-message"],
])("client decoder rejects %s", (_name, input, error) => {
  expect(decodeClientMessage(input)).toEqual({ ok: false, error });
});

it("rejects an inherited welcome discriminator", () => {
  const input: unknown = Object.create(
    { type: "welcome" },
    { extra: { value: 1, enumerable: true } },
  );
  expect(decodeServerMessage(input)).toEqual({
    ok: false,
    error: "invalid-message",
  });
});

it.each(["invalid-json", "invalid-message", "unrecognized-message"])(
  "decodes error %s",
  (error) => {
    expect(
      decodeServerMessage(JSON.stringify({ type: "error", error })),
    ).toEqual({
      ok: true,
      message: { type: "error", error },
    });
  },
);

it.each(["join", "commit"])("accepts %s", (type) => {
  expect(decodeClientMessage(JSON.stringify({ type }))).toEqual({
    ok: true,
    message: { type },
  });
});
it("accepts a full staged list", () => {
  expect(
    decodeClientMessage({ type: "stage", plays: [{ cardId: "a", lane: 2 }] }),
  ).toEqual({
    ok: true,
    message: { type: "stage", plays: [{ cardId: "a", lane: 2 }] },
  });
});

const card = { id: "a", name: "Aster", cost: 1, power: 2 };
const score = { lanes: [0, null, 1], power: [2, 2], winner: null };
const view = {
  player: 0,
  turn: 1,
  energy: 1,
  phase: "planning",
  result: null,
  own: {
    hand: [card],
    staged: [{ cardId: "a", lane: 0 }],
    deckSize: 9,
    committed: false,
    lanes: [[], [], []],
  },
  opponent: {
    handSize: 3,
    deckSize: 9,
    committed: false,
    lanes: [[card], [], []],
  },
  events: [
    { type: "card-revealed", player: 1, lane: 0, card },
    { type: "turn-ended", turn: 1 },
    { type: "match-ended", result: score },
  ],
};
it.each([
  { type: "waiting" },
  { type: "state", view },
  { type: "state", view: { ...view, phase: "ended", result: score } },
])("decodes $type", (message) => {
  expect(decodeServerMessage(JSON.stringify(message))).toEqual({
    ok: true,
    message,
  });
});
it.each(["join", "commit", "stage", "waiting", "state"])(
  "strict %s envelopes",
  (type) => {
    const decode = ["join", "commit", "stage"].includes(type)
      ? decodeClientMessage
      : decodeServerMessage;
    const message =
      type === "stage"
        ? { type, plays: [] }
        : type === "state"
          ? { type, view }
          : { type };
    for (const input of [
      { ...message, extra: true },
      { ...message, constructor: {} },
      JSON.stringify(message).replace(/}$/, ',"__proto__":{}}'),
      { ...message, type: 42 },
      {},
      null,
      "{",
    ]) {
      expect(decode(input).ok).toBe(false);
    }
  },
);
it.each([
  undefined,
  null,
  2,
  {},
  [null],
  [{ cardId: 1, lane: 0 }],
  [{ cardId: "a" }],
  [{ cardId: "a", lane: "0" }],
  ...[-1, 0.5, 1e100, 3, NaN, Infinity].map((lane) => [{ cardId: "a", lane }]),
  Array.from({ length: 13 }, () => ({ cardId: "a", lane: 0 })),
  [{ cardId: "a", lane: 0, extra: true }],
  parse('[{"cardId":"a","lane":0,"__proto__":{}}]'),
  [{ cardId: "a", lane: 0, constructor: {} }],
])("rejects invalid plays %j", (plays) => {
  expect(decodeClientMessage({ type: "stage", plays })).toEqual({
    ok: false,
    error: "invalid-message",
  });
});
it.each([
  { ...view, opponent: { ...view.opponent, hand: [card] } },
  { ...view, own: { ...view.own, deck: [card] } },
  { ...view, own: { ...view.own, hand: [{ ...card, secret: true }] } },
  { ...view, own: { ...view.own, lanes: [[], []] } },
  { ...view, opponent: { ...view.opponent, lanes: [[], [], [], []] } },
  { ...view, opponent: { ...view.opponent, lanes: [[null], [], []] } },
  {
    ...view,
    opponent: { ...view.opponent, lanes: [Array(5).fill(card), [], []] },
  },
  { ...view, own: { ...view.own, committed: 0 } },
  { ...view, opponent: { ...view.opponent, handSize: -1 } },
  { ...view, events: [{ type: "card-revealed", player: 2, lane: 0, card }] },
  { ...view, events: [{ type: "card-revealed", player: 0, lane: -1, card }] },
  { ...view, events: [{ type: "turn-ended", turn: 0 }] },
  {
    ...view,
    events: [{ type: "match-ended", result: { ...score, power: [1] } }],
  },
  { ...view, events: [{ type: "unknown" }] },
  { ...view, events: {} },
  { ...view, phase: "ended" },
  { ...view, result: score },
  { ...view, turn: 1.5 },
  { ...view, energy: Infinity },
  { ...view, player: 3 },
  { ...view, constructor: {} },
  parse(JSON.stringify(view).replace(/}$/, ',"__proto__":{}}')),
])("rejects malformed or hidden view %j", (invalidView) => {
  expect(decodeServerMessage({ type: "state", view: invalidView })).toEqual({
    ok: false,
    error: "invalid-message",
  });
});

function parse(text: string): unknown {
  return JSON.parse(text);
}
