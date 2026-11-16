import { randomBytes, randomInt } from "node:crypto";
import {
  createMatch,
  shuffle,
  forfeit,
  applyAction,
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
  return shuffle(starterDeck(player), (bound) => randomInt(bound));
}
/** Owns the queue and match lifecycle for a single server instance. */
export function matchHost(
  inputs: () => {
    seed: number;
    decks: Parameters<typeof createMatch>[1];
  } = () => ({
    seed: randomBytes(4).readUInt32LE(),
    decks: [privateDeck(0), privateDeck(1)],
  }),
) {
  // A peer may answer synchronously from send(). Finish delivering the current
  // transition to both players before applying any of those replies.
  const pending: (() => void)[] = [];
  let processing = false;
  function run(operation: () => void) {
    pending.push(operation);
    if (processing) return;
    processing = true;
    try {
      let next;
      while ((next = pending.shift())) next();
    } finally {
      processing = false;
      pending.length = 0;
    }
  }
  let waiting: Peer | undefined;
  const seats = new Map<Peer, Seat>();
  function error(peer: Peer) {
    send(peer, { type: "error", error: "invalid-message" });
  }
  /** Seats distinct, unseated peers; queued peers may be seated directly. */
  function start(first: Peer, second: Peer) {
    if (first === second || seats.has(first) || seats.has(second))
      throw new Error("peers must be distinct and unseated");
    const { seed, decks } = inputs();
    const match: Match = {
      state: createMatch(seed, decks),
      peers: [first, second],
    };
    seats.set(first, { match, player: 0 });
    seats.set(second, { match, player: 1 });
    if (waiting === first || waiting === second) waiting = undefined;
    broadcast(match);
  }
  return {
    start(first: Peer, second: Peer) {
      run(() => {
        start(first, second);
      });
    },
    message(peer: Peer, message: ClientMessage) {
      run(() => {
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
          start(waiting, peer);
          return;
        }
        if (!seat) {
          error(peer);
          return;
        }
        const { match, player } = seat;
        const result = applyAction(match.state, player, message);
        if (!result.ok) {
          error(peer);
          return;
        }
        match.state = result.value;
        broadcast(match);
      });
    },
    close(peer: Peer) {
      run(() => {
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
      });
    },
  };
}
