import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { URL, fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "working-markdown-"));
const checker = fileURLToPath(
  new URL("./check-working-markdown.mjs", import.meta.url),
);
function git(...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
function run() {
  return spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
  });
}
try {
  git("init", "--quiet");
  writeFileSync(join(root, ".gitignore"), ".scratch/\n.out-of-scope/\n");
  git("add", ".gitignore");
  assert.equal(run().status, 0);
  for (const path of [
    ".scratch/research/123.md",
    ".out-of-scope/rejected.md",
    "to-questionnaire-topic.md",
    "nested/to-questionnaire-topic.md",
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "temporary findings");
    // Ignored, untracked working files are allowed.
    assert.equal(run().status, 0);
    git("add", "-f", "--", path);
    const result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes(path), result.stderr);
    git("rm", "--cached", "--", path);
    rmSync(join(root, path));
  }
  writeFileSync(join(root, "AGENTS.md"), "durable knowledge");
  git("add", "AGENTS.md");
  assert.equal(run().status, 0);
  console.log("working-markdown regression cases passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
