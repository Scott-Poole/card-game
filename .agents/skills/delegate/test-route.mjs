process.env.CARD_GAME_USAGE_FILE = "/nonexistent/card-game-test-usage.json";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
const route = ".agents/skills/delegate/route.sh";
const result = JSON.parse(
  execFileSync("bash", [route, "plan"], { encoding: "utf8" }),
);
assert.equal(result[0].providerInstanceId, "claudeAgent");
assert.equal(result[1].providerInstanceId, "codex");
assert.deepEqual(
  JSON.parse(
    execFileSync("bash", [route, "plan", "--out", "claudeAgent"], {
      encoding: "utf8",
    }),
  ),
  [result[1]],
);
const bad = spawnSync("bash", [route, "missing"], { encoding: "utf8" });
assert.notEqual(bad.status, 0);
assert.match(bad.stderr, /unknown tier/i);
// A copied installation proves every referencing tier reads the alias at launch.
const { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } =
  await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const temp = mkdtempSync(join(tmpdir(), "routing-"));
try {
  cpSync(".agents/skills/delegate", temp, { recursive: true });
  const path = join(temp, "routing.json");
  const data = JSON.parse(readFileSync(path));
  data.aliases["codex.workhorse"].model = "replacement-model";
  writeFileSync(path, JSON.stringify(data));
  for (const [tier, aliases] of Object.entries(data.tiers)) {
    const targets = JSON.parse(
      execFileSync("bash", [join(temp, "route.sh"), tier]),
    );
    aliases
      .flatMap((alias) => data.groups?.[alias] ?? [alias])
      .forEach((alias, index) => {
        if (alias === "codex.workhorse")
          assert.equal(targets[index].model, "replacement-model");
      });
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
const run = (...args) =>
  JSON.parse(execFileSync("bash", [route, ...args], { encoding: "utf8" }));
assert.deepEqual(run("plan", "--out", "claude"), [result[1]]);
assert.deepEqual(run("plan", "--out", "claude,codex"), []);
assert.equal(run("review.two-family")[0].options.variant, "high");
assert.equal(run("review.claude", "--out", "codex")[0].options.variant, "high");
assert.notEqual(spawnSync("bash", [route, "plan", "--out", "codx"]).status, 0);
const catalog = JSON.parse(
  readFileSync(".agents/skills/delegate/routing.json"),
);
assert.ok(Object.hasOwn(catalog.aliases, catalog.orchestrator.alias));
for (const [tier, aliases] of Object.entries(catalog.tiers)) {
  for (const alias of aliases.flatMap(
    (alias) => catalog.groups?.[alias] ?? [alias],
  ))
    assert.ok(Object.hasOwn(catalog.aliases, alias), `${tier}: ${alias}`);
}
for (const file of [
  ".agents/skills/delegate/SKILL.md",
  ".agents/skills/tick/SKILL.md",
  ".agents/skills/land/SKILL.md",
  "docs/agents/nightly-triage.md",
]) {
  for (const [, reference] of readFileSync(file, "utf8").matchAll(
    /`((?:codex|claude|flash|implement|review)\.[a-z-]+)`/g,
  )) {
    assert.ok(
      Object.hasOwn(catalog.aliases, reference) ||
        Object.hasOwn(catalog.tiers, reference),
      `${file}: unresolved ${reference}`,
    );
  }
}

console.log("router tests passed");
