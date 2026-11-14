import { startServer } from "./index.ts";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
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
