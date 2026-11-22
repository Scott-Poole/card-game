import { opponentOf, type Effect, type PlayerId } from "../rules/index.ts";
import type { LaneCard, MatchState, MatchEvent, PlayerState } from "./index.ts";

function replace(
  state: MatchState,
  id: PlayerId,
  player: PlayerState,
): MatchState {
  return {
    ...state,
    players: id === 0 ? [player, state.players[1]] : [state.players[0], player],
  };
}
/** The revealing card is already on the board at printed power.
 * Only cards currently on the board participate. No RNG samples are consumed.
 * Returned events belong to this ability; the caller owns the turn event log.
 */
export function resolveOnReveal(
  state: MatchState,
  id: PlayerId,
  laneIndex: number,
  effect: Effect,
  cardId: string,
): { readonly state: MatchState; readonly events: readonly MatchEvent[] } {
  let updated = state;
  const events: MatchEvent[] = [];
  const player = state.players[id];
  const lane = [...(player.lanes[laneIndex] ?? [])];
  switch (effect.kind) {
    case "boost-self": {
      const index = lane.findIndex((card) => card.id === cardId);
      const revealed = lane[index];
      if (!revealed) throw new Error("Revealing card must be in its lane");
      lane[index] = {
        ...revealed,
        power: revealed.power + effect.amount,
      };
      events.push({
        type: "power-changed",
        player: id,
        lane: laneIndex,
        cardId,
        power: revealed.power + effect.amount,
      });
      break;
    }
    case "destroy-weakest-enemy": {
      const enemyId = opponentOf(id);
      const enemy = updated.players[enemyId];
      const targets = enemy.lanes[laneIndex] ?? [];
      const target = targets.reduce<LaneCard | undefined>(
        (weakest, candidate) =>
          !weakest || candidate.power < weakest.power ? candidate : weakest,
        undefined,
      );
      if (target) {
        updated = replace(updated, enemyId, {
          ...enemy,
          lanes: enemy.lanes.map((cards, index) =>
            index === laneIndex ? cards.filter((c) => c !== target) : cards,
          ),
          zones: {
            ...enemy.zones,
            destroyed: [...enemy.zones.destroyed, target.printed],
          },
        });
        events.push({
          type: "card-destroyed",
          player: enemyId,
          lane: laneIndex,
          cardId: target.id,
        });
      }
      break;
    }
    case "weaken-lane-enemies": {
      // Only already revealed enemies in this lane participate.
      const enemyId = opponentOf(id);
      const enemy = updated.players[enemyId];
      const enemyLanes = enemy.lanes.map((cards, index) =>
        index !== laneIndex
          ? cards
          : cards.map((target) => {
              const power = Math.max(0, target.power - effect.amount);
              if (power === target.power) return target;
              events.push({
                type: "power-changed",
                player: enemyId,
                lane: laneIndex,
                cardId: target.id,
                power,
              });
              return { ...target, power };
            }),
      );
      updated = replace(updated, enemyId, { ...enemy, lanes: enemyLanes });
      break;
    }
    case "boost-lane-allies":
      for (let index = 0; index < lane.length; index++) {
        const ally = lane[index];
        if (!ally || ally.id === cardId) continue;
        const power = ally.power + effect.amount;
        lane[index] = { ...ally, power };
        events.push({
          type: "power-changed",
          player: id,
          lane: laneIndex,
          cardId: ally.id,
          power,
        });
      }
      break;
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
  updated = replace(updated, id, {
    ...updated.players[id],
    lanes: updated.players[id].lanes.map((cards, index) =>
      index === laneIndex ? lane : cards,
    ),
  });
  return { state: updated, events };
}
