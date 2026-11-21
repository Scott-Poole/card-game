import { privateDeck } from "./match.ts";
import { roster } from "./roster.ts";
import { DECK_CARDS_PER_COST, DECK_SIZE } from "../rules/index.ts";
import { afterEach, expect, test, vi } from "vitest";
import {
  decodeServerMessage,
  type ServerMessage,
} from "../protocol/messages.ts";
import { startServer, type ServerHandle } from "./index.ts";
import type { LocationDefinition } from "../rules/index.ts";
// No effects, so lane totals equal printed power whichever lanes a seed draws.
const plainPool: readonly LocationDefinition[] = ["a", "b", "c"].map((id) => ({
  id: `plain-${id}`,
  name: `Plain ${id}`,
  text: "No effect for now.",
  effect: { kind: "none" },
}));
const entropy = vi.hoisted(() => ({
  integer: vi.fn((max: number) => max - 1),
}));
// Fix only the external entropy source; engine and transport stay real.
vi.mock("node:crypto", () => ({
  randomBytes: () => Buffer.alloc(4),
  randomInt: entropy.integer,
}));
let server: ServerHandle | undefined;
afterEach(() => server?.close());
async function client(port: number) {
  const socket = new WebSocket(`ws://localhost:${String(port)}/ws`);
  const frames: string[] = [];
  const messages: ServerMessage[] = [];
  const readers: ((m: ServerMessage) => void)[] = [];
  socket.addEventListener("message", (e) => {
    const raw = String(e.data);
    frames.push(raw);
    const decoded = decodeServerMessage(raw);
    if (!decoded.ok) throw new Error(raw);
    const reader = readers.shift();
    if (reader) reader(decoded.message);
    else messages.push(decoded.message);
  });
  const next = () =>
    new Promise<ServerMessage>((resolve) => {
      const m = messages.shift();
      if (m) resolve(m);
      else readers.push(resolve);
    });
  await next();
  return {
    socket,
    frames,
    next,
    send: (m: unknown) => {
      socket.send(JSON.stringify(m));
    },
  };
}
test("pairs waiting clients and gives each their own player view", async () => {
  server = await startServer({ port: 0, clientDirectory: "dist" });
  const a = await client(server.port);
  const b = await client(server.port);
  a.send({ type: "join" });
  expect(await a.next()).toEqual({ type: "waiting" });
  b.send({ type: "join" });
  const first = await a.next();
  const second = await b.next();
  expect(first.type).toBe("state");
  expect(second.type).toBe("state");
  if (first.type !== "state" || second.type !== "state")
    throw new Error("missing state");
  expect(first.view.player).toBe(0);
  expect(second.view.player).toBe(1);
  expect(first.view.own.hand).toHaveLength(3);
  a.socket.close();
  b.socket.close();
});

async function pair(locations?: readonly LocationDefinition[]) {
  server = await startServer({
    port: 0,
    clientDirectory: "dist",
    ...(locations && { locations }),
  });
  const a = await client(server.port),
    b = await client(server.port);
  a.send({ type: "join" });
  await a.next();
  b.send({ type: "join" });
  return { a, b, views: await states(a, b) };
}
async function states(
  a: Awaited<ReturnType<typeof client>>,
  b: Awaited<ReturnType<typeof client>>,
) {
  const x = await a.next(),
    y = await b.next();
  if (x.type !== "state" || y.type !== "state")
    throw new Error("expected state");
  return [x.view, y.view] satisfies readonly [typeof x.view, typeof y.view];
}
test("six turns resolve, reject illegal actions privately, and never expose hidden fields", async () => {
  const { a, b, views: initial } = await pair(plainPool);
  let views = initial;
  async function illegal(message: unknown) {
    a.send(message);
    expect(await a.next()).toEqual({ type: "error", error: "invalid-message" });
    // A subsequent successful request is an ordered barrier on both streams.
    a.send({ type: "stage", plays: [] });
    views = await states(a, b);
  }
  await illegal({ type: "join" });
  await illegal({ type: "stage", plays: [{ cardId: "unknown", lane: 0 }] });
  await illegal({
    type: "stage",
    plays: views[0].own.hand.map((c) => ({ cardId: c.id, lane: 0 })),
  });
  for (let turn = 1; turn <= 6; turn++) {
    const card = views[0].own.hand.find((c) => c.cost <= turn);
    a.send({
      type: "stage",
      plays: card ? [{ cardId: card.id, lane: turn % 3 }] : [],
    });
    views = await states(a, b);
    expect(views[1].opponent).not.toHaveProperty("staged");
    a.send({ type: "commit" });
    await states(a, b);
    a.send({ type: "stage", plays: [] });
    expect(await a.next()).toEqual({ type: "error", error: "invalid-message" });
    b.send({ type: "commit" });
    views = await states(a, b);
    expect(views[0].own.lanes).toEqual(views[1].opponent.lanes);
    expect(views[1].own.lanes).toEqual(views[0].opponent.lanes);
    expect(views[0].turn).toBe(Math.min(turn + 1, 6));
  }
  expect(views[0].phase).toBe("ended");
  expect(views[0].result).toEqual(views[1].result);
  for (const peer of [a, b])
    for (const frame of peer.frames) {
      const decoded = decodeServerMessage(frame);
      expect(decoded.ok).toBe(true);
      if (decoded.ok && decoded.message.type === "state") {
        expect(Object.keys(decoded.message.view.opponent).sort()).toEqual([
          "committed",
          "deckSize",
          "handSize",
          "lanes",
          "zones",
        ]);
        expect(frame).not.toContain('"deck":');
        expect(frame).not.toContain('"rng":');
        for (const field of ["figure", "tradition", "flavor"])
          expect(frame).not.toContain(JSON.stringify(field) + ":");
        if (peer === a)
          for (const { card } of roster)
            expect(frame).not.toContain(JSON.stringify(`1:${card.id}`));
      }
    }
  a.socket.close();
  b.socket.close();
});
test("requests before joining fail; a departed waiter is removed; disconnect forfeits", async () => {
  server = await startServer({ port: 0, clientDirectory: "dist" });
  const departed = await client(server.port);
  departed.send({ type: "stage", plays: [] });
  expect((await departed.next()).type).toBe("error");
  departed.send({ type: "commit" });
  expect((await departed.next()).type).toBe("error");
  departed.send({ type: "join" });
  await departed.next();
  departed.send({ type: "join" });
  expect((await departed.next()).type).toBe("error");
  const closed = new Promise<void>((resolve) => {
    departed.socket.addEventListener(
      "close",
      () => {
        resolve();
      },
      { once: true },
    );
  });
  departed.socket.close();
  await closed;
  const a = await client(server.port),
    b = await client(server.port);
  a.send({ type: "join" });
  expect(await a.next()).toEqual({ type: "waiting" });
  b.send({ type: "join" });
  await states(a, b);
  a.socket.close();
  const final = await b.next();
  expect(final.type).toBe("state");
  if (final.type === "state") {
    expect(final.view.phase).toBe("ended");
    expect(final.view.result?.winner).toBe(final.view.player);
  }
  b.socket.close();
});

test("a fifth card in a lane fails privately and a revised legal play succeeds", async () => {
  const { a, b, views: initial } = await pair(plainPool);
  let views = initial;
  for (let turn = 1; turn <= 4; turn++) {
    const card = views[0].own.hand.find((c) => c.cost <= turn);
    if (!card) throw new Error("fixture must offer a legal card");
    a.send({ type: "stage", plays: [{ cardId: card.id, lane: 0 }] });
    await states(a, b);
    a.send({ type: "commit" });
    await states(a, b);
    b.send({ type: "commit" });
    views = await states(a, b);
  }
  expect(views[0].own.lanes[0]).toHaveLength(4);
  // Derived, not pinned: which cards the draw offers depends on roster order.
  const lanePower = (views[0].own.lanes[0] ?? []).reduce(
    (sum, c) => sum + c.power,
    0,
  );
  const card = views[0].own.hand.find((c) => c.cost <= 5);
  if (!card) throw new Error("missing fifth card");
  a.send({ type: "stage", plays: [{ cardId: card.id, lane: 0 }] });
  expect(await a.next()).toEqual({ type: "error", error: "invalid-message" });
  a.send({ type: "stage", plays: [{ cardId: card.id, lane: 1 }] });
  views = await states(a, b);
  expect(views[0].own.staged).toEqual([{ cardId: card.id, lane: 1 }]);
  a.socket.close();
  const final = await b.next();
  if (final.type !== "state") throw new Error("missing forfeit state");
  expect(final.view.result).toEqual({
    lanes: [0, null, null],
    power: [lanePower, 0],
    winner: 1,
  });
  expect(final.view.events).toEqual([
    { type: "match-ended", result: final.view.result },
  ]);
  b.socket.close();
});

test("both players' raw frames contain only revealed opponent card ids", async () => {
  const { a, b, views: initial } = await pair(plainPool);
  let views = initial;
  const first = views[0].own.hand.find((c) => c.cost === 1);
  const second = views[1].own.hand.find((c) => c.cost <= 2);
  if (!first || !second) throw new Error("fixture missing cards");
  // Advance to turn two so both players can stage known affordable cards.
  a.send({ type: "commit" });
  await states(a, b);
  b.send({ type: "commit" });
  views = await states(a, b);
  a.send({ type: "stage", plays: [{ cardId: first.id, lane: 0 }] });
  await states(a, b);
  b.send({ type: "stage", plays: [{ cardId: second.id, lane: 1 }] });
  await states(a, b);
  for (const [peer, hidden] of [
    [a, views[1].own.hand],
    [b, views[0].own.hand],
  ] satisfies readonly (readonly [
    typeof a,
    (typeof views)[0]["own"]["hand"],
  ])[]) {
    for (const frame of peer.frames)
      for (const card of hidden) expect(frame).not.toContain(card.id);
  }
  a.send({ type: "stage", plays: [{ cardId: "unknown", lane: 0 }] });
  expect(await a.next()).toEqual({ type: "error", error: "invalid-message" });
  a.send({ type: "commit" });
  await states(a, b);
  b.send({ type: "commit" });
  views = await states(a, b);
  expect(views[0].opponent.lanes[1]).toContainEqual({
    ...second,
    power:
      second.power +
      (second.ability?.effect.kind === "boost-self"
        ? second.ability.effect.amount
        : 0),
  });
  expect(views[1].opponent.lanes[0]).toContainEqual({
    ...first,
    power:
      first.power +
      (first.ability?.effect.kind === "boost-self"
        ? first.ability.effect.amount
        : 0),
  });
  a.socket.close();
  b.socket.close();
});

test("with the same engine seed, independent entropy changes only the opponent's draw order", async () => {
  entropy.integer.mockClear();
  const first = await pair();
  server?.close();
  // Each player's deck takes the same number of samples; player 0's come first.
  const perDeck = entropy.integer.mock.calls.length / 2;
  let calls = 0;
  entropy.integer.mockImplementation((max) =>
    ++calls <= perDeck ? max - 1 : 0,
  );
  try {
    const second = await pair();
    expect(second.views[0].own.hand).toEqual(first.views[0].own.hand);
    expect(second.views[1].own.hand).not.toEqual(first.views[1].own.hand);
    expect(second.views[1].own.deckSize).toBe(9);
    expect(new Set(second.views[1].own.hand.map((c) => c.id)).size).toBe(3);
  } finally {
    entropy.integer.mockImplementation((max) => max - 1);
  }
});

async function concurrentPairs() {
  server = await startServer({ port: 0, clientDirectory: "dist" });
  const a = await client(server.port),
    b = await client(server.port);
  a.send({ type: "join" });
  expect(await a.next()).toEqual({ type: "waiting" });
  b.send({ type: "join" });
  const first = await states(a, b);
  const c = await client(server.port);
  c.send({ type: "join" });
  expect(await c.next()).toEqual({ type: "waiting" });
  const d = await client(server.port);
  d.send({ type: "join" });
  const second = await states(c, d);
  for (const views of [first, second]) {
    expect(views.map((view) => view.player)).toEqual([0, 1]);
    expect(views.map((view) => view.phase)).toEqual(["planning", "planning"]);
    expect(views.map((view) => view.turn)).toEqual([1, 1]);
  }
  return { a, b, c, d, first, second };
}

test("four clients have isolated actions and a forfeit leaves the other match playable", async () => {
  const { a, b, c, d, first, second } = await concurrentPairs();
  const counts = [c.frames.length, d.frames.length];
  const card = first[0].own.hand.find((candidate) => candidate.cost === 1);
  if (!card) throw new Error("fixture must offer a one-energy card");
  const plays = [{ cardId: card.id, lane: 0 }];
  a.send({ type: "stage", plays });
  const staged = await states(a, b);
  expect(staged[0].own.staged).toEqual(plays);
  a.send({ type: "commit" });
  const committed = await states(a, b);
  expect(committed[0].own.committed).toBe(true);
  expect(committed[1].opponent.committed).toBe(true);

  // A commit round-trip on both second-match streams drains any leaked frames.
  d.send({ type: "commit" });
  const barrier = await states(c, d);
  expect([c.frames.length, d.frames.length]).toEqual(
    counts.map((count) => count + 1),
  );
  expect(barrier).toEqual([
    { ...second[0], opponent: { ...second[0].opponent, committed: true } },
    { ...second[1], own: { ...second[1].own, committed: true } },
  ]);

  const beforeForfeit = [c.frames.length, d.frames.length];
  a.socket.close();
  const ended = await b.next();
  if (ended.type !== "state") throw new Error("expected forfeit state");
  expect(ended.view.phase).toBe("ended");
  expect(ended.view.result?.winner).toBe(ended.view.player);

  c.send({ type: "stage", plays });
  const stillPlaying = await states(c, d);
  expect([c.frames.length, d.frames.length]).toEqual(
    beforeForfeit.map((count) => count + 1),
  );
  expect(stillPlaying[0].phase).toBe("planning");
  expect(stillPlaying[0].own.staged).toEqual(plays);
  expect(stillPlaying[1]).toEqual(barrier[1]);
  for (const peer of [b, c, d]) peer.socket.close();
});

test("a fifth client queues after a forfeit and a sixth pairs while another match runs", async () => {
  const { a, b, c, d, second } = await concurrentPairs();
  a.socket.close();
  const ended = await b.next();
  if (ended.type !== "state") throw new Error("expected forfeit state");
  expect(ended.view.phase).toBe("ended");
  if (!server) throw new Error("expected running server");
  const e = await client(server.port);
  e.send({ type: "join" });
  expect(await e.next()).toEqual({ type: "waiting" });
  const f = await client(server.port);
  f.send({ type: "join" });
  const fresh = await states(e, f);
  expect(fresh.map((view) => view.player)).toEqual([0, 1]);
  expect(fresh.map((view) => view.turn)).toEqual([1, 1]);
  expect(fresh.map((view) => view.phase)).toEqual(["planning", "planning"]);
  const counts = [c.frames.length, d.frames.length];
  c.send({ type: "stage", plays: [] });
  expect(await states(c, d)).toEqual(second);
  expect([c.frames.length, d.frames.length]).toEqual(
    counts.map((count) => count + 1),
  );
  for (const peer of [b, c, d, e, f]) peer.socket.close();
});

test("a player whose match has ended can join again; a live match still rejects join", async () => {
  const { a, b } = await pair();
  a.send({ type: "join" });
  expect(await a.next()).toEqual({ type: "error", error: "invalid-message" });
  b.send({ type: "join" });
  expect(await b.next()).toEqual({ type: "error", error: "invalid-message" });
  for (let turn = 0; turn < 6; turn++) {
    a.send({ type: "commit" });
    await states(a, b);
    b.send({ type: "commit" });
    await states(a, b);
  }
  a.send({ type: "join" });
  expect(await a.next()).toEqual({ type: "waiting" });
  b.send({ type: "join" });
  const fresh = await states(a, b);
  expect(fresh.map((view) => [view.turn, view.phase])).toEqual([
    [1, "planning"],
    [1, "planning"],
  ]);
  a.socket.close();
  b.socket.close();
});

test("each player's private deck is a valid draw from the roster", async () => {
  for (const player of [0, 1] as const) {
    // The mocked entropy never swaps, so each cost's first two cards are drawn.
    const expected = [1, 2, 3, 4, 5, 6].flatMap((cost) =>
      roster
        .filter((entry) => entry.card.cost === cost)
        .slice(0, DECK_CARDS_PER_COST)
        .map((entry) => `${String(player)}:${entry.card.id}`),
    );
    const deck = privateDeck(player, roster);
    expect(deck).toHaveLength(DECK_SIZE);
    expect(deck.map((card) => card.id).sort()).toEqual(expected.sort());
    expect(privateDeck(player)).toHaveLength(DECK_SIZE);
  }
  const { a, b, views } = await pair();
  views.forEach((view, player) => {
    for (const card of view.own.hand)
      expect(card.id.startsWith(`${String(player)}:`)).toBe(true);
  });
  a.socket.close();
  b.socket.close();
});
