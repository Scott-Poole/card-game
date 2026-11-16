import { URL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "skill-links-"));
const checker = new URL("./test-skill-links.mjs", import.meta.url);
async function put(path, text) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), text);
}
function run() {
  return spawnSync(process.execPath, [fileURLToPath(checker), root], {
    encoding: "utf8",
  });
}
try {
  await put("skills-lock.json", JSON.stringify({ skills: { upstream: {} } }));
  await put(".agents/skills/upstream/SKILL.md", "[example](missing.md)");
  await put(
    ".agents/skills/owned/nested/reference.md",
    "[live](../SKILL.md#part?query)",
  );
  await put(
    ".agents/skills/owned/SKILL.md",
    "[live](nested/reference.md?query#part)\n[dead](missing.md)\n",
  );
  await put(
    "AGENTS.md",
    "[web](https://example.invalid) [http](http://example.invalid) [mail](mailto:a@example.invalid) [anchor](#part)",
  );
  await put("docs/agents/guide.md", "[live](../../AGENTS.md)");
  let result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.equal(
    result.stderr,
    ".agents/skills/owned/SKILL.md:2 -> missing.md\n",
  );
  assert.doesNotMatch(result.stderr, /upstream/);
  await put(
    ".agents/skills/owned/SKILL.md",
    "[live](nested/reference.md?query#part)",
  );
  result = run();
  assert.equal(result.status, 0, result.stderr);
  for (const path of [
    "AGENTS.md",
    "docs/agents/guide.md",
    ".agents/skills/owned/nested/reference.md",
  ]) {
    const original = await readFile(join(root, path), "utf8");
    await put(path, "[dead](missing.md)");
    result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, `${path}:1 -> missing.md\n`);
    await put(path, original);
  }
  console.log("skill-link regression cases passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
