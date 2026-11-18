import { laneTotal } from "../rules/index.ts";
import type { LocationEffect } from "../rules/index.ts";

interface RevealedLanes {
  readonly lanes: readonly (readonly { readonly power: number }[])[];
}

// Deliberately reads only public lane cards and locations, never the hand or
// staged plays. Totals come from the shared rules helper the engine scores with.
export function selectLaneTotals(view: {
  readonly own: RevealedLanes;
  readonly opponent: RevealedLanes;
  readonly locations: readonly { readonly effect: LocationEffect }[];
}) {
  const totals = (side: RevealedLanes) =>
    side.lanes.map((cards, lane) =>
      laneTotal(cards, view.locations[lane]?.effect ?? { kind: "none" }),
    );
  return { own: totals(view.own), opponent: totals(view.opponent) };
}
