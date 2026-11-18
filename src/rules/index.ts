export const LANE_COUNT = 3;
export const LANE_CAPACITY = 4;
export const TURN_LIMIT = 6;
export const DECK_SIZE = 12;

/** What a location does. Closed union: a new kind fails the typecheck at
 * LOCATION_EFFECT_KINDS (and at every exhaustive switch) until it is handled. */
export interface NoLocationEffect {
  readonly kind: "none";
}
export type LocationEffect = NoLocationEffect;
export type LocationEffectKind = LocationEffect["kind"];
const LOCATION_EFFECT_KINDS: Readonly<Record<LocationEffectKind, true>> = {
  none: true,
};
export function isLocationEffectKind(
  kind: unknown,
): kind is LocationEffectKind {
  return typeof kind === "string" && Object.hasOwn(LOCATION_EFFECT_KINDS, kind);
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
export interface StagingView {
  readonly phase: "planning" | "ended";
  readonly energy: number;
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
    if (count > LANE_CAPACITY) return { ok: false, error: "full-lane" };
  }
  if (cost > view.energy) return { ok: false, error: "overspend" };
  return { ok: true };
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
