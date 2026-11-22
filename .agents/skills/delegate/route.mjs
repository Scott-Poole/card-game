import { readFileSync } from "node:fs";
const [tier, ...args] = process.argv.slice(2);
try {
  if (args.length && (args.length !== 2 || args[0] !== "--out"))
    throw new Error("usage: route.sh <tier> [--out claude,codex]");
  const routing = JSON.parse(
    readFileSync(new URL("./routing.json", import.meta.url)),
  );
  if (!Object.hasOwn(routing.tiers, tier))
    throw new Error(`unknown tier: ${tier}`);
  const out = new Set(
    (args[1] ?? "").split(",").map((p) => (p === "claude" ? "claudeAgent" : p)),
  );
  const routes = routing.tiers[tier]
    .map((alias) => {
      const entry = routing.aliases[alias];
      if (!entry) throw new Error(`unknown alias: ${alias}`);
      return {
        ...entry,
        options: {
          ...entry.options,
          ...(tier.startsWith("review.") &&
          entry.providerInstanceId === "opencode"
            ? { variant: "high" }
            : {}),
        },
      };
    })
    .filter((entry) => !out.has(entry.providerInstanceId));
  console.log(JSON.stringify(routes));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
