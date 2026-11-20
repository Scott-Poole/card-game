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
const locations = [
  {
    id: "place-a",
    name: "Place A",
    text: "No effect for now.",
    effect: { kind: "none" },
  },
  {
    id: "place-b",
    name: "Place B",
    text: "No effect for now.",
    effect: { kind: "none" },
  },
  {
    id: "place-c",
    name: "Place C",
    text: "No effect for now.",
    effect: { kind: "none" },
  },
];
const view = {
  player: 0,
  turn: 1,
  energy: 1,
  revealFirst: 1,
  locations,
  phase: "planning",
  result: null,
  own: {
    hand: [card],
    staged: [{ cardId: "a", lane: 0 }],
    deckSize: 9,
    committed: false,
    lanes: [[], [], []],
    zones: { destroyed: [], discarded: [card], banished: [] },
  },
  opponent: {
    handSize: 3,
    deckSize: 9,
    committed: false,
    lanes: [[card], [], []],
    zones: { destroyed: [card], discarded: [card, card], banished: [card] },
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
  {
    type: "state",
    view: { ...view, phase: "ended", result: score, revealFirst: null },
  },
  ...[1, 2].map((amount) => ({
    type: "state",
    view: {
      ...view,
      locations: [
        {
          ...locations[0],
          text: `Each card adds ${String(amount)} power.`,
          effect: { kind: "power-per-card", amount },
        },
        ...locations.slice(1),
      ],
    },
  })),
  ...[1, 2, 3].map((limit) => ({
    type: "state",
    view: {
      ...view,
      locations: [
        {
          ...locations[0],
          text: `At most ${String(limit)} cards each.`,
          effect: { kind: "lane-capacity", limit },
        },
        ...locations.slice(1),
      ],
    },
  })),
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
it.each(
  [
    undefined,
    null,
    2,
    {},
    [null],
    [{ cardId: 1, lane: 0 }],
    [{ cardId: "a" }],
    [{ cardId: "a", lane: "0" }],
    ...[-1, 0.5, 1e100, 3, NaN, Infinity].map((lane) => [
      { cardId: "a", lane },
    ]),
    Array.from({ length: 13 }, () => ({ cardId: "a", lane: 0 })),
    [{ cardId: "a", lane: 0, extra: true }],
    parse('[{"cardId":"a","lane":0,"__proto__":{}}]'),
    [{ cardId: "a", lane: 0, constructor: {} }],
  ].map((plays) => ({ plays })),
)("rejects invalid plays %j", ({ plays }) => {
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
  { ...view, phase: "ended", result: score },
  { ...view, revealFirst: null },
  { ...view, revealFirst: 2 },
  Object.fromEntries(
    Object.entries(view).filter(([key]) => key !== "revealFirst"),
  ),
  { ...view, result: score },
  { ...view, turn: 1.5 },
  { ...view, energy: Infinity },
  { ...view, player: 3 },
  { ...view, constructor: {} },
  { ...view, locations: locations.slice(0, 2) },
  { ...view, locations: [...locations, locations[0]] },
  { ...view, locations: [] },
  { ...view, locations: "none" },
  {
    ...view,
    locations: [
      { ...locations[0], effect: { kind: "teleport" } },
      ...locations.slice(1),
    ],
  },
  {
    ...view,
    locations: [{ ...locations[0], secret: true }, ...locations.slice(1)],
  },
  {
    ...view,
    locations: [
      { ...locations[0], effect: { kind: "none", amount: 1 } },
      ...locations.slice(1),
    ],
  },
  ...[
    ["zero", { kind: "power-per-card", amount: 0 }],
    ["three", { kind: "power-per-card", amount: 3 }],
    ["non-integer", { kind: "power-per-card", amount: 1.5 }],
    ["string", { kind: "power-per-card", amount: "1" }],
    ["missing", { kind: "power-per-card" }],
    ["extra key", { kind: "power-per-card", amount: 1, extra: true }],
    ["capacity zero", { kind: "lane-capacity", limit: 0 }],
    ["capacity four", { kind: "lane-capacity", limit: 4 }],
    ["capacity non-integer", { kind: "lane-capacity", limit: 2.5 }],
    ["capacity string", { kind: "lane-capacity", limit: "2" }],
    ["capacity missing limit", { kind: "lane-capacity" }],
    ["capacity amount instead", { kind: "lane-capacity", amount: 2 }],
    ["capacity extra key", { kind: "lane-capacity", limit: 2, extra: true }],
  ].map(([, effect]) => ({
    ...view,
    locations: [{ ...locations[0], effect }, ...locations.slice(1)],
  })),
  { ...view, locations: [{ ...locations[0], text: 7 }, ...locations.slice(1)] },
  { ...view, locations: [locations[0], locations[0], locations[2]] },
  {
    ...view,
    locations: [{ ...locations[0], name: "  " }, ...locations.slice(1)],
  },
  {
    ...view,
    locations: [
      { ...locations[0], text: "x".repeat(161) },
      ...locations.slice(1),
    ],
  },
  {
    ...view,
    locations: [
      { ...locations[0], name: "x".repeat(41) },
      ...locations.slice(1),
    ],
  },
  parse(JSON.stringify(view).replace(/}$/, ',"__proto__":{}}')),
])("rejects malformed or hidden view %j", (invalidView) => {
  expect(decodeServerMessage({ type: "state", view: invalidView })).toEqual({
    ok: false,
    error: "invalid-message",
  });
});

function withoutZones(player: object) {
  return Object.fromEntries(
    Object.entries(player).filter(([key]) => key !== "zones"),
  );
}
function parse(text: string): unknown {
  return JSON.parse(text);
}

it.each([
  {
    ...view,
    own: { staged: [], deckSize: 9, committed: false, lanes: [[], [], []] },
  },
  { ...view, opponent: { deckSize: 9, committed: false, lanes: [[], [], []] } },
  { ...view, own: withoutZones(view.own) },
  { ...view, opponent: withoutZones(view.opponent) },
  {
    ...view,
    own: { ...view.own, zones: { destroyed: [], discarded: [] } },
  },
  {
    ...view,
    own: { ...view.own, hand: [{ id: "a", name: "Aster", cost: 1 }] },
  },
  { ...view, events: [{ type: "card-revealed", player: 0, lane: 0 }] },
  { ...view, phase: "ended", result: { lanes: [0, 0, 0], power: [1, 0] } },
])("rejects missing nested fields %j", (invalidView) => {
  expect(decodeServerMessage({ type: "state", view: invalidView })).toEqual({
    ok: false,
    error: "invalid-message",
  });
});

it.each(
  [
    [],
    Array.from({ length: 12 }, (_, i) => ({ cardId: String(i), lane: i % 3 })),
  ].map((plays) => ({ plays })),
)("accepts clearing and maximum staging", ({ plays }) => {
  expect(decodeClientMessage({ type: "stage", plays })).toEqual({
    ok: true,
    message: { type: "stage", plays },
  });
});
it.each([{ type: "state" }, { type: "stage" }])(
  "rejects missing payload $type",
  (message) => {
    const decode =
      message.type === "state" ? decodeServerMessage : decodeClientMessage;
    expect(decode(message)).toEqual({ ok: false, error: "invalid-message" });
  },
);
it("accepts full hand and lane capacity", () => {
  const fullView = {
    ...view,
    own: {
      ...view.own,
      hand: Array(12).fill(card),
      lanes: [Array(4).fill(card), [], []],
    },
  };
  expect(decodeServerMessage({ type: "state", view: fullView })).toEqual({
    ok: true,
    message: { type: "state", view: fullView },
  });
});
it.each([
  "player",
  "turn",
  "energy",
  "locations",
  "own",
  "opponent",
  "events",
  "phase",
  "result",
])("rejects missing view %s", (key) => {
  const incomplete = Object.fromEntries(
    Object.entries(view).filter(([k]) => k !== key),
  );
  expect(decodeServerMessage({ type: "state", view: incomplete })).toEqual({
    ok: false,
    error: "invalid-message",
  });
});
it.each(["__proto__", "constructor"])("rejects nested %s keys", (key) => {
  const extra = { [key]: {} };
  for (const invalidView of [
    { ...view, own: { ...view.own, ...extra } },
    { ...view, opponent: { ...view.opponent, ...extra } },
    { ...view, own: { ...view.own, hand: [{ ...card, ...extra }] } },
    { ...view, events: [{ type: "turn-ended", turn: 1, ...extra }] },
    { ...view, phase: "ended", result: { ...score, ...extra } },
  ]) {
    expect(
      decodeServerMessage(JSON.stringify({ type: "state", view: invalidView })),
    ).toEqual({ ok: false, error: "invalid-message" });
  }
});
it("rejects extra properties on parsed arrays", () => {
  const plays = Object.assign([{ cardId: "a", lane: 0 }], { secret: true });
  expect(decodeClientMessage({ type: "stage", plays })).toEqual({
    ok: false,
    error: "invalid-message",
  });
});

it.each([{ type: "welcome" }, { type: "error", error: "invalid-json" }])(
  "rejects extra symbol keys on $type messages",
  (message) => {
    expect(
      decodeServerMessage({ ...message, [Symbol("extra")]: true }),
    ).toEqual({
      ok: false,
      error: "invalid-message",
    });
  },
);

it.each([
  new (class Welcome {
    type = "welcome";
  })(),
  new (class ErrorMessage {
    type = "error";
    error = "invalid-json";
  })(),
])("rejects class instances for $type messages", (message) => {
  expect(decodeServerMessage(message)).toEqual({
    ok: false,
    error: "invalid-message",
  });
});

it.each([
  [
    "an unknown zone",
    { destroyed: [], discarded: [], banished: [], limbo: [] },
  ],
  [
    "a zone that is not a list",
    { destroyed: card, discarded: [], banished: [] },
  ],
  [
    "a malformed card in a zone",
    { destroyed: [], discarded: [], banished: [{ id: "x" }] },
  ],
  [
    "a zone longer than a deck",
    {
      destroyed: Array.from({ length: 13 }, () => card),
      discarded: [],
      banished: [],
    },
  ],
  ["zones as a list", [[], [], []]],
])("rejects %s in either player's zones", (_name, zones) => {
  for (const side of ["own", "opponent"] as const)
    expect(
      decodeServerMessage({
        type: "state",
        view: { ...view, [side]: { ...view[side], zones } },
      }),
    ).toEqual({ ok: false, error: "invalid-message" });
});

it("decodes full zone lists for both players: every zone is face up", () => {
  const decoded = decodeServerMessage({ type: "state", view });
  expect(decoded).toEqual({ ok: true, message: { type: "state", view } });
});

it.each([
  ...[1, 2, 0, 3, -1, 1.5, "1", null, undefined].map(
    (amount): [unknown, boolean] => [
      { text: "Drain power.", effect: { kind: "weaken-lane-enemies", amount } },
      amount === 1 || amount === 2,
    ],
  ),
  [
    {
      text: "Drain 2 power.",
      effect: { kind: "weaken-lane-enemies", amount: 2, extra: true },
    },
    false,
  ],
  ...[1, 2, 0, 3].map((amount): [unknown, boolean] => [
    { text: "Share power.", effect: { kind: "boost-lane-allies", amount } },
    amount === 1 || amount === 2,
  ]),
  [
    {
      text: "Share power.",
      effect: { kind: "boost-lane-allies", amount: 2, extra: true },
    },
    false,
  ],
  [{ text: "Gain 2 power.", effect: { kind: "boost-self", amount: 2 } }, true],
  [{ text: "Gain power.", effect: { kind: "unknown", amount: 2 } }, false],
  [{ text: "Gain power.", effect: { kind: "boost-self", amount: 0 } }, false],
  [{ text: "Gain power.", effect: { kind: "boost-self", amount: 4 } }, false],
  [
    {
      text: "Gain power.",
      effect: { kind: "boost-self", amount: 2, extra: 1 },
    },
    false,
  ],
  [{ effect: { kind: "boost-self", amount: 2 } }, false],
  [{ text: " ", effect: { kind: "boost-self", amount: 2 } }, false],
  [
    { text: "Gain 2.", effect: { kind: "boost-self", amount: 2 }, extra: 1 },
    false,
  ],
])("strict ability decoding %#", (ability, ok) => {
  const message = {
    type: "state",
    view: {
      ...view,
      own: {
        ...view.own,
        hand: [{ id: "a", name: "A", cost: 1, power: 1, ability }],
      },
    },
  };
  for (const input of [message, JSON.stringify(message)])
    expect(decodeServerMessage(input).ok).toBe(ok);
  expect(decodeClientMessage(message).ok).toBe(false);
});
it.each([true, false])("power-changed event decoding valid=%s", (valid) => {
  const event = {
    type: "power-changed",
    player: 0,
    lane: 0,
    cardId: "a",
    power: 3,
    ...(valid ? {} : { extra: 1 }),
  };
  const message = { type: "state", view: { ...view, events: [event] } };
  for (const input of [message, JSON.stringify(message)])
    expect(decodeServerMessage(input).ok).toBe(valid);
  expect(decodeClientMessage(message).ok).toBe(false);
});
