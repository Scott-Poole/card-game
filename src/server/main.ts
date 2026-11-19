import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startServer } from "./index.ts";

const portText = process.env.PORT ?? "4747";
const port = Number(portText);
if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}
const clientDirectory = resolve(process.env.CLIENT_DIRECTORY ?? "dist");
const hasClientIndex = await (async () => {
  const index = join(clientDirectory, "index.html");
  try {
    if (!(await stat(index)).isFile()) return false;
    await access(index, constants.R_OK);
    return true;
  } catch {
    return false;
  }
})();
if (!hasClientIndex) {
  console.error(
    `No client found: ${join(clientDirectory, "index.html")} is not a readable file. Run \`pnpm build\` or set CLIENT_DIRECTORY to a built client directory.`,
  );
  process.exit(1);
}
const server = await startServer({ port, clientDirectory });
process.once("SIGINT", () => {
  server.close();
});
process.once("SIGTERM", () => {
  server.close();
});
console.log(`Listening on port ${String(server.port)}`);
