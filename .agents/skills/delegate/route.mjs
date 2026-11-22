import { readFileSync } from "node:fs";
import { readUsage, claudeShare } from "./usage.mjs";
const [tier, ...args] = process.argv.slice(2);
try {
  if (tier === "implementation-share") {
    const tick = JSON.parse(
      readFileSync(new URL("../tick/config.json", import.meta.url)),
    );
    console.log(claudeShare(tick.implement.claudeShare));
    process.exit(0);
  }
  if (args.length && (args.length !== 2 || args[0] !== "--out"))
    throw new Error("usage: route.sh <tier> [--out claude,codex]");
  const routing = JSON.parse(
    readFileSync(new URL("./routing.json", import.meta.url)),
  );
  if (!Object.hasOwn(routing.tiers, tier))
    throw new Error(`unknown tier: ${tier}`);
  const out = new Set(
    (args[1] ?? "").split(",").map((value) => {
      const p = value.trim();
      return p === "claude" ? "claudeAgent" : p;
    }),
  );
  for (const provider of out) {
    if (provider && !["codex", "claudeAgent", "opencode"].includes(provider))
      throw new Error(`unknown out provider: ${provider}`);
  }
  const usage = readUsage();
  const ranks = { prefer: 0, neutral: 1, unknown: 1, conserve: 2, out: 3 };
  const providerPosture = (p) => usage?.providers?.[p]?.posture ?? "neutral";
  const routes = routing.tiers[tier]
    .flatMap((alias) => routing.groups?.[alias] ?? [alias])
    .map((alias) => {
      const entry = routing.aliases[alias];
      if (!entry) throw new Error(`unknown alias: ${alias}`);
      return {
        alias,
        ...entry,
        options: {
          ...entry.options,
          ...routing.tierOptions?.[tier]?.[entry.providerInstanceId],
        },
      };
    })
    .filter(
      (entry) =>
        !out.has(entry.providerInstanceId) &&
        (providerPosture(entry.providerInstanceId) !== "out" ||
          entry.alias === "flash.paid"),
    );
  // Only subscription choices are interchangeable. Keep overflow positions,
  // and keep the primary picked by the derived implementation share.
  if (!["implement.claude", "implement.codex", "hard"].includes(tier)) {
    const subscriptions = routes
      .filter((e) => e.providerInstanceId !== "opencode")
      .sort(
        (a, b) =>
          (ranks[providerPosture(a.providerInstanceId)] ?? 1) -
          (ranks[providerPosture(b.providerInstanceId)] ?? 1),
      );
    let index = 0;
    for (let i = 0; i < routes.length; i++)
      if (routes[i].providerInstanceId !== "opencode")
        routes[i] = subscriptions[index++];
  }
  console.log(JSON.stringify(routes.map(({ alias, ...entry }) => entry)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
