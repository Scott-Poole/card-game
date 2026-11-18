// Starts the production server for browser tests with a controlled location
// pool: `E2E_LOCATIONS` is "boosted" (one power-per-card lane among two plain
// ones) or "plain" (no effects, so totals equal printed power).
import { startServer } from "../src/server/index.ts";
import type { LocationDefinition } from "../src/rules/index.ts";

const plain = (id: string): LocationDefinition => ({
  id: `plain-${id}`,
  name: `Plain ${id}`,
  text: "No effect for now.",
  effect: { kind: "none" },
});
const pool: readonly LocationDefinition[] =
  process.env.E2E_LOCATIONS === "boosted"
    ? [
        {
          id: "boosted-grove",
          name: "Boosted Grove",
          text: "Each of your cards here adds 2 power.",
          effect: { kind: "power-per-card", amount: 2 },
        },
        plain("one"),
        plain("two"),
      ]
    : [plain("one"), plain("two"), plain("three")];

const server = await startServer({
  port: Number(process.env.PORT ?? "0"),
  clientDirectory: process.env.CLIENT_DIRECTORY ?? "dist",
  locations: pool,
});
process.once("SIGTERM", () => {
  server.close();
});
console.log(`Listening on port ${String(server.port)}`);
