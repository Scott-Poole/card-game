import { afterEach, expect, test, vi } from "vitest";
import {
  decodeServerMessage,
  type ServerMessage,
} from "../protocol/messages.ts";
import { startServer, type ServerHandle } from "./index.ts";
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

async function pair() {
  server = await startServer({ port: 0, clientDirectory: "dist" });
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
  const { a, b, views: initial } = await pair();
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
        ]);
        expect(frame).not.toContain('"deck":');
        expect(frame).not.toContain('"rng":');
        if (peer === a) expect(frame).not.toContain("1:");
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
  const { a, b, views: initial } = await pair();
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
    power: [18, 0],
    winner: 1,
  });
  expect(final.view.events).toEqual([
    { type: "match-ended", result: final.view.result },
  ]);
  b.socket.close();
});

test("both players' raw frames contain only revealed opponent card ids", async () => {
  const { a, b, views: initial } = await pair();
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
  expect(views[0].opponent.lanes[1]).toContainEqual(second);
  expect(views[1].opponent.lanes[0]).toContainEqual(first);
  a.socket.close();
  b.socket.close();
});

test("with the same engine seed, independent entropy changes only the opponent's draw order", async () => {
  const first = await pair();
  server?.close();
  let calls = 0;
  entropy.integer.mockImplementation((max) => (++calls <= 11 ? max - 1 : 0));
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
