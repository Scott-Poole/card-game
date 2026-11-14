import { afterEach, expect, test } from "vitest";
import { decodeServerMessage } from "../protocol/messages.ts";
import { startServer, type ServerHandle } from "./index.ts";

let server: ServerHandle | undefined;
afterEach(() => server?.close());

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.addEventListener(
      "message",
      (event) => {
        resolve(event.data);
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        reject(new Error("WebSocket failed"));
      },
      { once: true },
    );
  });
}

test("a client receives a protocol welcome on a dynamically bound port", async () => {
  server = await startServer({ port: 0, clientDirectory: "dist" });
  expect(server.port).toBeGreaterThan(0);
  const socket = new WebSocket(`ws://localhost:${String(server.port)}/ws`);
  const message = await nextMessage(socket);
  expect(decodeServerMessage(message)).toEqual({
    ok: true,
    message: { type: "welcome" },
  });
  socket.close();
});

test.each(["{", '{"type":"unknown"}'])(
  "rejects %s and keeps the connection open",
  async (input) => {
    server = await startServer({ port: 0, clientDirectory: "dist" });
    const socket = new WebSocket(`ws://localhost:${String(server.port)}/ws`);
    await nextMessage(socket);
    for (const message of [input, input]) {
      const reply = nextMessage(socket);
      socket.send(message);
      expect(decodeServerMessage(await reply)).toEqual({
        ok: true,
        message: {
          type: "error",
          error: input === "{" ? "invalid-json" : "unrecognized-message",
        },
      });
      expect(socket.readyState).toBe(WebSocket.OPEN);
    }
    socket.close();
  },
);

test("close disconnects active clients and stops accepting connections", async () => {
  server = await startServer({ port: 0, clientDirectory: "dist" });
  const port = server.port;
  const socket = new WebSocket(`ws://localhost:${String(port)}/ws`);
  await nextMessage(socket);
  const closed = new Promise<void>((resolve) => {
    socket.addEventListener(
      "close",
      () => {
        resolve();
      },
      { once: true },
    );
  });
  server.close();
  await closed;
  await expect(fetch(`http://localhost:${String(port)}/`)).rejects.toThrow();
});

test.each([NaN, 65536, -1, 1.5])("rejects invalid port %s", async (port) => {
  await expect(startServer({ port, clientDirectory: "dist" })).rejects.toThrow(
    "port",
  );
});

test("rejects binary frames without closing the connection", async () => {
  server = await startServer({ port: 0, clientDirectory: "dist" });
  const socket = new WebSocket(`ws://localhost:${String(server.port)}/ws`);
  await nextMessage(socket);
  const reply = nextMessage(socket);
  socket.send(new Uint8Array([255, 254]));
  expect(decodeServerMessage(await reply)).toEqual({
    ok: true,
    message: { type: "error", error: "invalid-message" },
  });
  socket.close();
});

test("disconnects oversized frames at the transport limit", async () => {
  server = await startServer({ port: 0, clientDirectory: "dist" });
  const socket = new WebSocket(`ws://localhost:${String(server.port)}/ws`);
  await nextMessage(socket);
  const closed = new Promise<void>((resolve) => {
    socket.addEventListener(
      "close",
      () => {
        resolve();
      },
      { once: true },
    );
  });
  socket.send("x".repeat(20_000));
  await closed;
  expect(socket.readyState).toBe(WebSocket.CLOSED);
});
