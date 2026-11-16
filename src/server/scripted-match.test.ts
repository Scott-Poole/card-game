import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { applyAction, createMatch } from "../engine/index.ts";
import {
  decodeServerMessage,
  type ClientMessage,
} from "../protocol/messages.ts";
import { matchHost } from "./match.ts";
import { starterDeck } from "./roster.ts";
import { scriptedPlayer } from "./scripted-player.test-support.ts";

function run(seed: number, fixed = false) {
  const decks = [starterDeck(0), starterDeck(1)] as const;
  let authority = createMatch(seed, decks);
  const host = matchHost(() => ({ seed, decks }));
  const players = [scriptedPlayer(seed), scriptedPlayer(seed + 1)] as const;
  let deliveries = 0;
  function peer(id: 0 | 1) {
    return {
      send(raw: string) {
        const decoded = decodeServerMessage(raw);
        if (!decoded.ok || decoded.message.type !== "state")
          throw new Error("expected state, never error");
        const view = decoded.message.view;
        const own = authority.players[id];
        const opponent = authority.players[id === 0 ? 1 : 0];
        const serialized = JSON.stringify(view);
        // Check the actual host frames, including unknown fields rejected by the decoder.
        for (const card of [...opponent.hand, ...own.deck, ...opponent.deck])
          expect(serialized).not.toContain(JSON.stringify(card.id));
        expect(view.own.hand).toEqual(own.hand);
        expect(view.own.staged).toEqual(own.staged);
        expect(view.opponent.handSize).toBe(opponent.hand.length);
        expect(view.opponent).not.toHaveProperty("staged");
        expect(view.own).not.toHaveProperty("deck");
        expect(view.opponent).not.toHaveProperty("deck");
        players[id].send(raw);
        deliveries++;
      },
    };
  }
  const peers = [peer(0), peer(1)] as const;
  host.start(...peers);
  // Drive messages outside send(): the mirror and host apply each transition in
  // the same order. Only this harness, never a player, sees authoritative state.
  for (let turn = 1; turn <= 6; turn++) {
    for (const id of [0, 1] as const) {
      const messages: readonly ClientMessage[] =
        fixed && id === 1
          ? [{ type: "stage", plays: [] }, { type: "commit" }]
          : players[id].act();
      for (const message of messages) {
        if (message.type === "join") throw new Error("already seated");
        const next = applyAction(authority, id, message);
        if (!next.ok) throw new Error(next.error);
        authority = next.value;
        host.message(peers[id], message);
      }
    }
  }
  expect(deliveries).toBe(50);
  const endings = players.map((player) => player.view());
  for (const view of endings) {
    expect(view.phase).toBe("ended");
    expect(view.result).not.toBeNull();
    expect(view.result).toEqual(authority.result);
  }
  expect(players[0].events).toEqual(players[1].events);
  expect(
    players[0].events.filter((event) => event.type === "turn-ended"),
  ).toHaveLength(6);
  expect(players[0].events.at(-1)?.type).toBe("match-ended");
  expect(
    players[0].events.filter((event) => event.type === "card-revealed").length,
  ).toBeGreaterThan(0);
  return { result: endings[0]?.result, events: players[0].events };
}

test("50 seeded protocol matches finish without errors or private information leaks", () => {
  for (let seed = 1; seed <= 50; seed++) run(seed);
});

test("a seed reproduces final results and complete event lists", () => {
  expect(run(314159)).toEqual(run(314159));
});

test("a scripted player completes a mixed pairing against a fixed pass script", () => {
  run(42, true);
});

test("the scripted player imports only protocol and shared rules", () => {
  const source = readFileSync(
    new URL("./scripted-player.test-support.ts", import.meta.url),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  expect(imports.sort()).toEqual([
    "../protocol/messages.ts",
    "../rules/index.ts",
  ]);
  expect(source).not.toMatch(/\bimport\s*\(|\brequire\s*\(|\bimport\s*["']/);
});
