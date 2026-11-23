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
  // GLOSSARY.md and docs/adr/*.md are checked for dead Markdown links.
  await put("GLOSSARY.md", "[live](AGENTS.md)");
  await put("docs/adr/0001-example.md", "[live](../../AGENTS.md)");
  result = run();
  assert.equal(result.status, 0, result.stderr);
  for (const path of ["GLOSSARY.md", "docs/adr/0001-example.md"]) {
    const original = await readFile(join(root, path), "utf8");
    await put(path, "[dead](missing.md)");
    result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, `${path}:1 -> missing.md\n`);
    await put(path, original);
  }

  // Backticked repo paths must exist, in every checked file.
  await put("src/real.ts", "");
  await put("e2e/flows/play.spec.ts", "");
  const backticked = [
    "AGENTS.md",
    "GLOSSARY.md",
    "docs/adr/0001-example.md",
    "docs/agents/guide.md",
    ".agents/skills/owned/SKILL.md",
  ];
  for (const path of backticked) {
    const original = await readFile(join(root, path), "utf8");
    await put(path, "ok\nsee `src/does-not-exist.ts` here\n");
    result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, `${path}:2 -> src/does-not-exist.ts\n`);
    await put(path, original);
  }
  // A fenced block is checked too, and each root is recognised.
  await put(
    "AGENTS.md",
    "```sh\ncat `scripts/gone.mjs`\n```\n`.claude/gone` `.agents/gone` `docs/gone.md` `e2e/gone.ts`\n",
  );
  result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.equal(
    result.stderr,
    [
      "AGENTS.md:2 -> scripts/gone.mjs",
      "AGENTS.md:4 -> .claude/gone",
      "AGENTS.md:4 -> .agents/gone",
      "AGENTS.md:4 -> docs/gone.md",
      "AGENTS.md:4 -> e2e/gone.ts",
      "",
    ].join("\n"),
  );
  // Existing paths (file or directory), globs, placeholders, non-repo tokens,
  // partial-token matches and locked skills are not reported.
  await put(
    "AGENTS.md",
    [
      "`src/real.ts` `src/` `e2e/flows` `e2e/flows/play.spec.ts`",
      "`src/*.ts` `src/<name>.ts` `src/{a,b}.ts`",
      "`/tmp` `pnpm check` `node scripts/x.mjs` `./src/gone.ts` `other/src/gone.ts`",
      "see src/gone.ts and `src/real.ts` for more",
      "",
    ].join("\n"),
  );
  await put(".agents/skills/upstream/SKILL.md", "`src/does-not-exist.ts`");
  result = run();
  assert.equal(result.status, 0, result.stderr);

  console.log("skill-link regression cases passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
