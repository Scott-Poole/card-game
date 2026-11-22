import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const root = mkdtempSync(join(tmpdir(), "model-ids-"));
try {
  execFileSync("git", ["init", "-q", root]);
  mkdirSync(join(root, ".agents/skills/example"), { recursive: true });
  const path = join(root, ".agents/skills/example/SKILL.md");
  writeFileSync(path, "Use the workhorse alias.");
  const check = () =>
    spawnSync(
      process.execPath,
      [resolve("scripts/check-model-ids.mjs"), root],
      { encoding: "utf8" },
    );
  assert.equal(check().status, 0);
  for (const id of [
    "gpt-example",
    "claude-example",
    "deepseek-example",
    "opencode/example",
    "Opus 5.5",
    "Sonnet 5.5",
    "Haiku 5.5",
  ]) {
    writeFileSync(path, `Use ${id}.`);
    assert.equal(check().status, 1, id);
    assert.match(check().stderr, /SKILL.md:1/);
  }
  writeFileSync(path, "Use aliases.");
  for (const extension of ["mjs", "sh", "yml"]) {
    const script = join(root, `.agents/skills/example/run.${extension}`);
    writeFileSync(script, "gpt-example");
    assert.equal(check().status, 1, extension);
    rmSync(script);
  }
  execFileSync("git", ["-C", root, "add", "."]);
  rmSync(path);
  assert.equal(check().status, 0, "pending deletion");
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("model id guard regression passed");
