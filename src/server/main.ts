import { startServer } from "./index.ts";

const portText = process.env.PORT ?? "3000";
const port = Number(portText);
if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}
const server = await startServer({
  port,
  clientDirectory: process.env.CLIENT_DIRECTORY ?? "dist",
});
console.log(`Listening on port ${String(server.port)}`);
process.once("SIGINT", () => {
  server.close();
});
process.once("SIGTERM", () => {
  server.close();
});
