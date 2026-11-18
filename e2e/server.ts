// Starts the production server for browser tests with a controlled location
// pool built from the shipped content: `E2E_LOCATIONS` is "boosted" (the
// Forge Beneath Etna power-per-card lane among two plain ones) or "plain"
// (no effects, so totals equal printed power).
import { startServer } from "../src/server/index.ts";
import { locations } from "../src/server/locations.ts";

const plain = locations
  .filter((location) => location.effect.kind === "none")
  .slice(0, 3);
function boostedPool() {
  const forge = locations.find(
    (location) => location.id === "forge-beneath-etna",
  );
  if (!forge) throw new Error("shipped pool lost the Forge Beneath Etna");
  return [forge, ...plain.slice(0, 2)];
}
const pool = process.env.E2E_LOCATIONS === "boosted" ? boostedPool() : plain;

const server = await startServer({
  port: Number(process.env.PORT ?? "0"),
  clientDirectory: process.env.CLIENT_DIRECTORY ?? "dist",
  locations: pool,
});
process.once("SIGTERM", () => {
  server.close();
});
console.log(`Listening on port ${String(server.port)}`);
