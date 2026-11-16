interface RevealedLanes {
  readonly lanes: readonly (readonly { readonly power: number }[])[];
}

// Deliberately reads only public lane cards, never the hand or staged plays.
export function selectLaneTotals(view: {
  readonly own: RevealedLanes;
  readonly opponent: RevealedLanes;
}) {
  const totals = (side: RevealedLanes) =>
    side.lanes.map((cards) => cards.reduce((sum, card) => sum + card.power, 0));
  return { own: totals(view.own), opponent: totals(view.opponent) };
}
