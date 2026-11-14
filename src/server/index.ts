import { App, us_socket_local_port } from "uWebSockets.js";
import { decodeClientMessage } from "../protocol/messages.ts";
import type { ServerMessage } from "../protocol/messages.ts";

export interface ServerOptions {
  port: number;
  /** Reserved for built-client serving in the client ticket; unused here. */
  clientDirectory: string;
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
    },
    open(socket) {
      socket.send(JSON.stringify({ type: "welcome" } satisfies ServerMessage));
    },
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
