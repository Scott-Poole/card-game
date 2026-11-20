import { opponentOf } from "../rules/index.ts";
import { expect, it } from "vitest";
import {
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
