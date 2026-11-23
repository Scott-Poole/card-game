import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// A failed browser run in CI must leave evidence behind: Playwright records a trace and an
// HTML report, and check.yml uploads both when a step fails. This suite proves each half so
// neither can be dropped quietly.
const repo = resolve(import.meta.dirname, "..");
const workflowPath = join(repo, ".github/workflows/check.yml");

// Returns one message per way the workflow's failure upload is missing or incomplete. The
// check is line-based on purpose: the repo carries no YAML parser, and the workflow is flat.
export function findUploadDrift(workflow) {
  const lines = workflow.split("\n").map((line) => line.replace(/\r$/, ""));
  const start = lines.findIndex((line) =>
    /^\s*-\s+uses:\s*actions\/upload-artifact@/.test(line),
  );
  if (start === -1) return ["check.yml has no actions/upload-artifact step"];
  let end = start + 1;
  while (end < lines.length && !/^\s*-\s/.test(lines[end])) end += 1;
  const step = lines.slice(start, end).join("\n");
  const problems = [];
  if (!/^\s+if:\s*failure\(\)\s*$/m.test(step)) {
    problems.push("the upload-artifact step must run `if: failure()`");
  }
  // The `path: |` block, exactly: a prefixed or extra entry would upload nothing useful.
  const block = step.match(/^(\s+)path:\s*\|\s*\n((?:\1\s+\S.*\n?)+)/m);
  const uploaded = block
    ? block[2]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  for (const path of ["playwright-report/", "test-results/"]) {
    if (!uploaded.includes(path)) {
      problems.push(`the upload-artifact step must upload exactly ${path}`);
    }
  }
  // An empty upload must be loud: `ignore` hides a wrong path.
  if (/^\s+if-no-files-found:\s*ignore\s*$/m.test(step)) {
    problems.push("the upload-artifact step must not ignore missing files");
  }
  return problems;
}

const workflow = await readFile(workflowPath, "utf8");
assert.deepEqual(
  findUploadDrift(workflow),
  [],
  "check.yml upload step drifted",
);

// The check must bite: each way of weakening the step is caught.
assert.deepEqual(
  findUploadDrift(workflow.replace(/\n\s+if: failure\(\)/, "")).length,
  1,
  "removing `if: failure()` is caught",
);
assert.equal(
  findUploadDrift(
    workflow.replace(/\n\s+- uses: actions\/upload-artifact@[\s\S]*$/, "\n"),
  ).length,
  1,
  "removing the upload step is caught",
);
assert.equal(
  findUploadDrift(workflow.replace("playwright-report/", "report/")).length,
  1,
  "dropping a path is caught",
);
assert.equal(
  findUploadDrift(workflow.replace("if: failure()", "if: always()")).length,
  1,
  "weakening the condition is caught",
);
assert.equal(
  findUploadDrift(
    workflow.replace(
      /^(\s+)playwright-report\/$/m,
      "$1missing/playwright-report/",
    ),
  ).length,
  1,
  "a wrong path prefix is caught",
);
assert.equal(
  findUploadDrift(
    workflow.replace("retention-days: 7", "if-no-files-found: ignore"),
  ).length,
  1,
  "ignoring missing files is caught",
);
console.log("check.yml uploads Playwright evidence on failure");

// The real Playwright config must leave a trace and an HTML report when a test fails
// under CI, and must not retry.
const fixtureRoot = await mkdtemp(join(tmpdir(), "test-ci-artifacts-"));
try {
  await symlink(join(repo, "node_modules"), join(fixtureRoot, "node_modules"));
  const e2eDir = join(fixtureRoot, "e2e");
  await mkdir(e2eDir);
  await writeFile(
    join(e2eDir, "playwright.config.ts"),
    `import base from ${JSON.stringify(join(repo, "playwright.config.ts"))};\n` +
      `export default { ...base, testDir: ${JSON.stringify(e2eDir)} };\n`,
  );
  await writeFile(
    join(e2eDir, "failing.spec.ts"),
    'import { test, expect } from "@playwright/test";\n' +
      'test("fails on purpose", async ({ page }) => {\n' +
      '  await page.setContent("<p>hello</p>");\n' +
      "  expect(1).toBe(2);\n" +
      "});\n",
  );
  const result = spawnSync(
    join(repo, "node_modules", ".bin", "playwright"),
    ["test", "--config", join(e2eDir, "playwright.config.ts")],
    {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
      timeout: 120_000,
    },
  );
  const output = result.stdout + result.stderr;
  assert.notEqual(
    result.status,
    0,
    `the failing fixture must fail:\n${output}`,
  );
  assert.doesNotMatch(output, /retry/i, "a failing test must not be retried");
  // The workflow uploads these two directories (resolved against the run's cwd), so the
  // evidence must be inside them, not merely somewhere under the fixture.
  const traces = spawnSync(
    "find",
    [join(fixtureRoot, "test-results"), "-name", "trace.zip"],
    { encoding: "utf8" },
  ).stdout;
  assert.match(
    traces,
    /trace\.zip/,
    `a failed CI test must leave trace.zip under test-results/:\n${traces}\n${output}`,
  );
  assert.ok(
    existsSync(join(fixtureRoot, "playwright-report", "index.html")),
    `a failed CI test must leave playwright-report/index.html:\n${output}`,
  );
  console.log("playwright: a failed CI test leaves trace.zip and index.html");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
