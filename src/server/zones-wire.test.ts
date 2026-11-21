import { opponentOf } from "../rules/index.ts";
import { expect, it } from "vitest";
import {
  applyAction,
  createMatch,
  playerView,
  type CardDefinition,
} from "../engine/index.ts";
import { decodeServerMessage } from "../protocol/messages.ts";
import { testLocations } from "../engine/locations.test-support.ts";

const card = (id: string): CardDefinition => ({
  id,
  name: `Figure ${id}`,
  cost: 2,
  power: 3,
});

it("full zone lists survive projection, JSON and the strict decoder for both players", () => {
  const match = createMatch(5, [[card("a")], [card("b")]], testLocations);
  const [first, second] = match.players;
  const state = {
    ...match,
    players: [
      {
        ...first,
        zones: { destroyed: [card("d0")], discarded: [], banished: [] },
      },
      {
        ...second,
        zones: {
          destroyed: [],
          discarded: [card("x0"), card("x1")],
          banished: [card("b0")],
        },
      },
    ] as typeof match.players,
  };
  for (const id of [0, 1] as const) {
    const view = playerView(state, id);
    const decoded = decodeServerMessage(
      JSON.stringify({ type: "state", view }),
    );
    expect(decoded).toEqual({ ok: true, message: { type: "state", view } });
    if (!decoded.ok || decoded.message.type !== "state")
      throw new Error("expected a decoded state");
    const other = opponentOf(id);
    expect(decoded.message.view.own.zones).toEqual(state.players[id].zones);
    expect(decoded.message.view.opponent.zones).toEqual(
      state.players[other].zones,
    );
  }
});

it("a resolved destruction survives the wire in both views", () => {
  const target = { ...card("target"), cost: 0 };
  const destroyer: CardDefinition = {
    ...card("destroyer"),
    cost: 0,
    ability: {
      text: "Destroy weakest enemy.",
      effect: { kind: "destroy-weakest-enemy" },
    },
  };
  let state = createMatch(5, [[destroyer], [target]], testLocations);
  for (const action of [
    { type: "stage", player: 1, plays: [{ cardId: target.id, lane: 0 }] },
    { type: "commit", player: 0 },
    { type: "commit", player: 1 },
    { type: "stage", player: 0, plays: [{ cardId: destroyer.id, lane: 0 }] },
    { type: "commit", player: 0 },
    { type: "commit", player: 1 },
  ] as const) {
    const result = applyAction(state, action.player, action);
    if (!result.ok) throw new Error(result.error);
    state = result.value;
  }
  for (const id of [0, 1] as const) {
    const decoded = decodeServerMessage(
      JSON.stringify({ type: "state", view: playerView(state, id) }),
    );
    if (!decoded.ok || decoded.message.type !== "state")
      throw new Error("expected view");
    const enemy =
      id === 1 ? decoded.message.view.own : decoded.message.view.opponent;
    expect(enemy.zones.destroyed).toEqual([target]);
    expect(enemy.lanes[0]).toEqual([]);
  }
});
