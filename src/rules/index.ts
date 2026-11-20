export const LANE_COUNT = 3;
export const LANE_CAPACITY = 4;
export const TURN_LIMIT = 6;
/** A deck holds this many distinct cards at each cost from 1 to TURN_LIMIT,
 * the costs a turn's energy can pay for. */
export const DECK_CARDS_PER_COST = 2;
export const DECK_SIZE = TURN_LIMIT * DECK_CARDS_PER_COST;

/** The off-board zones a card can leave play into, each public to both
 * players: `destroyed` (removed from a lane), `discarded` (sent from hand)
 * and `banished` (removed from the match for good, from anywhere). */
export const ZONES = ["destroyed", "discarded", "banished"] as const;
export type Zone = (typeof ZONES)[number];

export const MAX_LOCATION_NAME = 40;
export const MAX_LOCATION_TEXT = 160;

/** What a location does. Closed union: adding a kind fails the typecheck at
 * LOCATION_EFFECT_KINDS and at laneTotal's exhaustive switch until both
 * handle it. */
export interface NoLocationEffect {
  readonly kind: "none";
}
/** Each of a player's revealed cards in the lane adds `amount` power. */
export interface PowerPerCardEffect {
  readonly kind: "power-per-card";
  readonly amount: 1 | 2;
}
/** Each player may reveal at most `limit` cards in the lane. */
export interface LaneCapacityEffect {
  readonly kind: "lane-capacity";
  readonly limit: 1 | 2 | 3;
}
export type LocationEffect =
  NoLocationEffect | PowerPerCardEffect | LaneCapacityEffect;
export type LocationEffectKind = LocationEffect["kind"];
const LOCATION_EFFECT_KINDS: Readonly<Record<LocationEffectKind, true>> = {
  none: true,
  "power-per-card": true,
  "lane-capacity": true,
};
export function isLocationEffectKind(
  kind: unknown,
): kind is LocationEffectKind {
  return typeof kind === "string" && Object.hasOwn(LOCATION_EFFECT_KINDS, kind);
}
/** True for an amount a `power-per-card` effect may carry. */
export function isPowerPerCardAmount(amount: unknown): amount is 1 | 2 {
  return amount === 1 || amount === 2;
}
/** True for a limit a `lane-capacity` effect may carry. */
export function isLaneCapacityLimit(limit: unknown): limit is 1 | 2 | 3 {
  return limit === 1 || limit === 2 || limit === 3;
}
/** How many cards each player may reveal in a lane with this effect (none:
 * the default LANE_CAPACITY). */
export function laneCapacity(effect: LocationEffect | undefined): number {
  if (!effect) return LANE_CAPACITY;
  switch (effect.kind) {
    case "lane-capacity":
      return effect.limit;
    case "none":
    case "power-per-card":
      return LANE_CAPACITY;
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}
/** One player's lane total: printed power of their revealed cards plus what
 * the lane's location effect adds. */
export function laneTotal(
  cards: readonly { readonly power: number }[],
  effect: LocationEffect,
): number {
  const printed = cards.reduce((sum, card) => sum + card.power, 0);
  switch (effect.kind) {
    case "none":
      return printed;
    case "power-per-card":
      return printed + effect.amount * cards.length;
    case "lane-capacity":
      return printed;
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}
/** One side's lane totals in lane order, given the match's lane locations.
 * The single implementation: engine scoring and the client's running totals
 * both call it. */
export function laneTotals(
  lanes: readonly (readonly { readonly power: number }[])[],
  locations: readonly { readonly effect: LocationEffect }[],
): number[] {
  return lanes.map((cards, lane) =>
    laneTotal(cards, locations[lane]?.effect ?? { kind: "none" }),
  );
}
export interface LocationDefinition {
  readonly id: string;
  readonly name: string;
  /** Plain-language rule text shown to players. */
  readonly text: string;
  readonly effect: LocationEffect;
}

export interface Play {
  readonly cardId: string;
  readonly lane: number;
}
export type PlayerId = 0 | 1;
/** The other player of the two. */
export function opponentOf(id: PlayerId): PlayerId {
  return id === 0 ? 1 : 0;
}
export interface StagingView {
  readonly phase: "planning" | "ended";
  readonly energy: number;
  /** One per lane, in lane order; a lane without one has the default capacity. */
  readonly locations: readonly { readonly effect: LocationEffect }[];
  readonly own: {
    readonly committed: boolean;
    readonly hand: readonly { readonly id: string; readonly cost: number }[];
    readonly lanes: readonly (readonly unknown[])[];
    readonly staged: readonly Play[];
  };
}
export type StagingError =
  | "card-not-in-hand"
  | "duplicate-card"
  | "overspend"
  | "full-lane"
  | "unknown-lane"
  | "wrong-phase"
  | "already-committed";
export type StagingCheck =
  { readonly ok: true } | { readonly ok: false; readonly error: StagingError };

/** Checks a replacement staging, preserving engine error precedence. */
export function checkStaging(
  view: StagingView,
  plays: readonly Play[],
): StagingCheck {
  if (view.phase !== "planning") return { ok: false, error: "wrong-phase" };
  if (view.own.committed) return { ok: false, error: "already-committed" };
  const seen = new Set<string>();
  const counts = view.own.lanes.map((l) => l.length);
  let cost = 0;
  for (const play of plays) {
    if (
      !Number.isInteger(play.lane) ||
      play.lane < 0 ||
      play.lane >= LANE_COUNT
    )
      return { ok: false, error: "unknown-lane" };
    if (seen.has(play.cardId)) return { ok: false, error: "duplicate-card" };
    seen.add(play.cardId);
    const card = view.own.hand.find((c) => c.id === play.cardId);
    if (!card) return { ok: false, error: "card-not-in-hand" };
    cost += card.cost;
    const count = (counts[play.lane] ?? 0) + 1;
    counts[play.lane] = count;
    if (count > laneCapacity(view.locations[play.lane]?.effect))
      return { ok: false, error: "full-lane" };
  }
  if (cost > view.energy) return { ok: false, error: "overspend" };
  return { ok: true };
}

/** True when the lane already holds as many revealed and staged cards as its
 * location allows, so no further card can be staged there. */
export function laneIsFull(view: StagingView, lane: number): boolean {
  const held =
    (view.own.lanes[lane]?.length ?? 0) +
    view.own.staged.filter((play) => play.lane === lane).length;
  return held >= laneCapacity(view.locations[lane]?.effect);
}

/** Every single play that can be appended to the current staging. */
export function legalPlays(view: StagingView): readonly Play[] {
  const plays: Play[] = [];
  for (const card of view.own.hand) {
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const play = { cardId: card.id, lane };
      if (checkStaging(view, [...view.own.staged, play]).ok) plays.push(play);
    }
  }
  return plays;
}

/** An on-reveal ability; vanilla cards omit it. */
export interface Ability {
  readonly text: string;
  readonly effect: Effect;
}
export interface Effect {
  readonly kind: "boost-self";
  readonly amount: number;
}
export function boostedPower(
  power: number,
  effect: Effect | undefined,
): number {
  const operation = effect ?? { kind: "none" as const };
  switch (operation.kind) {
    case "none":
      return power;
    case "boost-self":
      return power + operation.amount;
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}
