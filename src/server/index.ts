import { App, us_socket_local_port } from "uWebSockets.js";
import { decodeClientMessage } from "../protocol/messages.ts";
import type { ServerMessage } from "../protocol/messages.ts";

export interface ServerOptions {
  port: number;
  clientDirectory: string;
}
export interface ServerHandle {
  port: number;
  close(): void;
}

export function startServer(options: ServerOptions): Promise<ServerHandle> {
  const app = App().ws("/ws", {
    message(socket, buffer) {
      const result = decodeClientMessage(Buffer.from(buffer).toString("utf8"));
      if (!result.ok)
        socket.send(JSON.stringify({ type: "error", error: result.error }));
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
