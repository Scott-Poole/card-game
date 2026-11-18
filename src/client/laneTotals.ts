import { laneTotals } from "../rules/index.ts";
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
  return {
    own: laneTotals(view.own.lanes, view.locations),
    opponent: laneTotals(view.opponent.lanes, view.locations),
  };
}
