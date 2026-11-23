import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  for (const path of ["playwright-report/", "test-results/"]) {
    if (!step.includes(path)) {
      problems.push(`the upload-artifact step must upload ${path}`);
    }
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
  const found = spawnSync(
    "find",
    [
      fixtureRoot,
      "-name",
      "trace.zip",
      "-o",
      "-name",
      "index.html",
      "-not",
      "-path",
      "*/node_modules/*",
    ],
    { encoding: "utf8" },
  ).stdout;
  assert.match(
    found,
    /trace\.zip/,
    `a failed CI test must leave trace.zip:\n${found}\n${output}`,
  );
  assert.match(
    found,
    /playwright-report\/index\.html/,
    `a failed CI test must leave playwright-report/index.html:\n${found}\n${output}`,
  );
  console.log("playwright: a failed CI test leaves trace.zip and index.html");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
