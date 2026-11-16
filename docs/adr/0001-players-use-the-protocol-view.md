# Every player uses the protocol view

Every kind of player, including the browser and future bots, talks to the authoritative server through the wire protocol and the hidden-information-safe `PlayerView`, never through engine functions. This decision, settled in [spec #76](https://github.com/Scott-Poole/card-game/issues/76), gives all players the same information and action boundary instead of giving bots privileged engine access. Rule knowledge shared by the engine, protocol and clients lives in the small rules module so a client can assess legality from its view without full match state.

## Consequences

A bot is a protocol client that can run in-process or over a socket. Its decisions use the same view and messages as the browser; running beside the server does not grant access to engine state or opponent secrets. The server owns engine calls and remains authoritative even when a client has checked legality locally. This player boundary is a design requirement checked in review; current lint rules do not prohibit all client-to-engine imports or distinguish a future in-process bot from the server host.

## Implementation snapshot (2026-11-15, base fdbe798)

- `src/protocol/messages.ts` defines `ClientMessage` (`join`, `stage`, `commit`), `ServerMessage` and the wire `PlayerView`.
- `src/engine/index.ts` owns full `MatchState`, projects each player's information with `playerView`, and applies player actions through `applyAction`. These are server-side interfaces, not player entry points.
- `src/server/match.ts` implements `matchHost`, assigns seats by pairing queued peers, applies actions and sends each peer its own projected `state` message.
- `src/client/App.tsx` uses protocol messages and views to play through the browser.
- `src/rules/index.ts` supplies shared rule constants and the pure `checkStaging` and `legalPlays` helpers over a structural view. Engine, protocol and browser code already import this module.

Direct seating outside the queue and a scripted protocol player are not implemented in this checkout. In-process bots are a consequence of the decision, not an existing game mode. Follow-up tickets [#80](https://github.com/Scott-Poole/card-game/issues/80) and [#81](https://github.com/Scott-Poole/card-game/issues/81) cover those additions.
