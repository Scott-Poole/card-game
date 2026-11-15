import { randomBytes, randomInt } from "node:crypto";
import {
  createMatch,
  forfeit,
  stage,
  commit,
  resolve,
  playerView,
  type MatchState,
  type PlayerId,
} from "../engine/index.ts";
import type { ClientMessage, ServerMessage } from "../protocol/messages.ts";
import { starterDeck } from "./roster.ts";

interface Peer {
  send(message: string): unknown;
}
interface Match {
  state: MatchState;
  peers: readonly [Peer, Peer];
}
interface Seat {
  match: Match;
  player: PlayerId;
}
function send(peer: Peer, message: ServerMessage) {
  peer.send(JSON.stringify(message));
}
function broadcast(match: Match) {
  send(match.peers[0], { type: "state", view: playerView(match.state, 0) });
  send(match.peers[1], { type: "state", view: playerView(match.state, 1) });
}
// Independent cryptographic permutations keep opponent draws secret even if
// the engine's replay seed is guessed from a player's own draw order.
function privateDeck(player: PlayerId) {
  const cards = [...starterDeck(player)];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = cards[i],
      b = cards[j];
    if (a && b) {
      cards[i] = b;
      cards[j] = a;
    }
  }
  return cards;
}
/** Owns the queue and match lifecycle for a single server instance. */
export function matchHost() {
  let waiting: Peer | undefined;
  const seats = new Map<Peer, Seat>();
  function error(peer: Peer) {
    send(peer, { type: "error", error: "invalid-message" });
  }
  return {
    message(peer: Peer, message: ClientMessage) {
      const seat = seats.get(peer);
      if (message.type === "join") {
        if (seat || waiting === peer) {
          error(peer);
          return;
        }
        if (!waiting) {
          waiting = peer;
          send(peer, { type: "waiting" });
          return;
        }
        const match: Match = {
          state: createMatch(randomBytes(4).readUInt32LE(), [
            privateDeck(0),
            privateDeck(1),
          ]),
          peers: [waiting, peer],
        };
        seats.set(waiting, { match, player: 0 });
        seats.set(peer, { match, player: 1 });
        waiting = undefined;
        broadcast(match);
        return;
      }
      if (!seat) {
        error(peer);
        return;
      }
      const { match, player } = seat;
      const result =
        message.type === "stage"
          ? stage(match.state, player, message.plays)
          : commit(match.state, player);
      if (!result.ok) {
        error(peer);
        return;
      }
      match.state = result.value;
      if (match.state.players.every((p) => p.committed)) {
        const resolved = resolve(match.state);
        if (!resolved.ok) throw new Error("Committed match could not resolve");
        match.state = resolved.value.state;
      }
      broadcast(match);
    },
    close(peer: Peer) {
      if (waiting === peer) waiting = undefined;
      const seat = seats.get(peer);
      seats.delete(peer);
      if (!seat || seat.match.state.phase === "ended") return;
      const { match, player } = seat;
      const winner = player === 0 ? 1 : 0;
      match.state = forfeit(match.state, player);
      send(match.peers[winner], {
        type: "state",
        view: playerView(match.state, winner),
      });
    },
  };
}
