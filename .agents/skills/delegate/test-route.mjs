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
console.log("router tests passed");
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
    aliases.forEach((alias, index) => {
      if (alias === "codex.workhorse")
        assert.equal(targets[index].model, "replacement-model");
    });
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
