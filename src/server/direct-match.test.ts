import { expect, test } from "vitest";
import { decodeServerMessage, type PlayerView } from "../protocol/messages.ts";
import { matchHost } from "./match.ts";
import { drawDeck } from "./roster.ts";

const fixedIndex = () => 0;

function peer() {
  const views: PlayerView[] = [];
  return {
    views,
    send(raw: string) {
      const decoded = decodeServerMessage(raw);
      if (!decoded.ok || decoded.message.type !== "state")
        throw new Error("expected a valid state frame");
      views.push(decoded.message.view);
    },
  };
}
function latest(p: ReturnType<typeof peer>) {
  const view = p.views.at(-1);
  if (!view) throw new Error("missing view");
  return view;
}

test("direct peers receive private views and can stage through host messages", () => {
  const host = matchHost(() => ({
    seed: 42,
    decks: [drawDeck(0, fixedIndex), drawDeck(1, fixedIndex)],
  }));
  const a = peer(),
    b = peer();
  host.start(a, b);
  expect(latest(a).player).toBe(0);
  expect(latest(b).player).toBe(1);
  for (const p of [a, b]) {
    expect(latest(p).own.hand).toHaveLength(3);
    expect(Object.keys(latest(p).opponent).sort()).toEqual([
      "committed",
      "deckSize",
      "handSize",
      "lanes",
    ]);
    expect(JSON.stringify(p.views)).not.toContain('"deck":');
  }
  const card = latest(a).own.hand.find((card) => card.cost === 1);
  if (!card) throw new Error("fixture needs a one-energy card");
  host.message(a, { type: "stage", plays: [{ cardId: card.id, lane: 0 }] });
  expect(latest(a).own.staged).toEqual([{ cardId: card.id, lane: 0 }]);
  expect(latest(b).opponent).not.toHaveProperty("staged");
  for (const hidden of latest(a).own.hand)
    expect(JSON.stringify(b.views)).not.toContain(hidden.id);
  expect(a.views).toHaveLength(2);
  expect(b.views).toHaveLength(2);
});

test("injected seed and decks replay the same opening views", () => {
  const options = {
    seed: 42,
    decks: [drawDeck(0, fixedIndex), drawDeck(1, fixedIndex)],
  } satisfies ReturnType<NonNullable<Parameters<typeof matchHost>[0]>>;
  function opening() {
    const host = matchHost(() => options);
    const a = peer(),
      b = peer();
    host.start(a, b);
    return [latest(a), latest(b)];
  }
  expect(opening()).toEqual(opening());
});

test("default matches use independent private decks", () => {
  const host = matchHost();
  const hands = [];
  for (let i = 0; i < 4; i++) {
    const a = peer(),
      b = peer();
    host.start(a, b);
    hands.push(latest(a).own.hand);
  }
  expect(
    new Set(hands.map((hand) => JSON.stringify(hand))).size,
  ).toBeGreaterThan(1);
});

test("closing an in-process peer forfeits to the remaining peer", () => {
  const host = matchHost();
  const a = peer(),
    b = peer();
  host.start(a, b);
  host.close(a);
  expect(latest(b).phase).toBe("ended");
  expect(latest(b).result?.winner).toBe(1);
});

test("synchronous replies receive each transition once in order", () => {
  const host = matchHost();
  function scripted() {
    const p = peer();
    let committedTurn = 0;
    return {
      views: p.views,
      send(raw: string) {
        p.send(raw);
        const view = latest(p);
        if (view.phase === "planning" && view.turn !== committedTurn) {
          committedTurn = view.turn;
          host.message(this, { type: "commit" });
        }
      },
    };
  }
  const a = scripted(),
    b = scripted();
  host.start(a, b);
  for (const p of [a, b]) {
    expect(p.views[0]?.opponent.committed).toBe(false);
    expect(p.views.filter((view) => view.phase === "ended")).toHaveLength(1);
    expect(p.views.map((view) => view.turn)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6,
    ]);
  }
});

test("a match draws its lanes' locations from the injected pool", () => {
  const pool = ["a", "b", "c"].map((id) => ({
    id: `place-${id}`,
    name: `Place ${id}`,
    text: "Each card adds 1 power.",
    effect: { kind: "power-per-card", amount: 1 } as const,
  }));
  const host = matchHost(
    () => ({
      seed: 5,
      decks: [drawDeck(0, fixedIndex), drawDeck(1, fixedIndex)],
    }),
    pool,
  );
  const a = peer(),
    b = peer();
  host.start(a, b);
  expect(
    latest(a)
      .locations.map((location) => location.id)
      .sort(),
  ).toEqual(pool.map((location) => location.id));
});
