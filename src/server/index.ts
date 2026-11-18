import { matchHost } from "./match.ts";
import { staticResponse } from "./static.ts";
import { decodeClientMessage } from "../protocol/messages.ts";
import { LANE_COUNT, type LocationDefinition } from "../rules/index.ts";
import type { ServerMessage } from "../protocol/messages.ts";
import { createRequire } from "node:module";
import type * as UWebSockets from "uWebSockets.js";

// uWebSockets.js v20.71.0's ESM wrapper imports a file the release doesn't ship
// (uNetworking/uWebSockets.js#1356, fixed on master, unreleased). Load the CommonJS
// entry instead. Once a release includes the fix, switch back to a plain import.
const { App, us_socket_local_port } = createRequire(import.meta.url)(
  "uWebSockets.js",
) as typeof UWebSockets;

export interface ServerOptions {
  port: number;
  /** Directory containing the production client. */
  clientDirectory: string;
  /** Location pool matches draw from; defaults to the shipped pool. */
  locations?: readonly LocationDefinition[];
}
export interface ServerHandle {
  port: number;
  /** Abruptly disconnect all clients and stop listening; safe to call again. */
  close(): void;
}

export function startServer(options: ServerOptions): Promise<ServerHandle> {
  if (
    !Number.isInteger(options.port) ||
    options.port < 0 ||
    options.port > 65535
  ) {
    return Promise.reject(
      new Error("port must be an integer between 0 and 65535"),
    );
  }
  const pool = options.locations;
  if (
    pool &&
    (pool.length < LANE_COUNT ||
      new Set(pool.map((location) => location.id)).size !== pool.length)
  ) {
    return Promise.reject(
      new Error("locations need a unique id per entry, at least one per lane"),
    );
  }
  const matches = matchHost(undefined, pool);
  const app = App().ws("/ws", {
    // Transport limits: oversize frames disconnect rather than enter the decoder.
    maxPayloadLength: 16 * 1024,
    idleTimeout: 120,
    maxBackpressure: 64 * 1024,
    closeOnBackpressureLimit: true,
    message(socket, buffer, isBinary) {
      const result = isBinary
        ? ({ ok: false, error: "invalid-message" } satisfies {
            ok: false;
            error: "invalid-message";
          })
        : decodeClientMessage(Buffer.from(buffer).toString("utf8"));
      if (!result.ok)
        socket.send(
          JSON.stringify({
            type: "error",
            error: result.error,
          } satisfies ServerMessage),
        );
      else matches.message(socket, result.message);
    },
    close(socket) {
      matches.close(socket);
    },
    open(socket) {
      socket.send(JSON.stringify({ type: "welcome" } satisfies ServerMessage));
    },
  });
  app.any("/*", (response, request) => {
    const method = request.getMethod();
    if (method !== "get" && method !== "head") {
      response
        .writeStatus("405 Method Not Allowed")
        .writeHeader("Allow", "GET, HEAD")
        .end();
      return;
    }
    const file = staticResponse(options.clientDirectory, request.getUrl());
    response
      .writeStatus(file.status)
      .writeHeader("Content-Type", file.type)
      .writeHeader("X-Content-Type-Options", "nosniff");
    if (method === "head")
      response.endWithoutBody(Buffer.byteLength(file.body));
    else response.end(file.body);
  });
  return new Promise((resolve, reject) => {
    app.listen(options.port, (socket) => {
      if (!socket) {
        reject(new Error(`Unable to listen on port ${String(options.port)}`));
        return;
      }
      let closed = false;
      resolve({
        port: us_socket_local_port(socket),
        close: () => {
          if (closed) return;
          closed = true;
          app.close();
        },
      });
    });
  });
}
