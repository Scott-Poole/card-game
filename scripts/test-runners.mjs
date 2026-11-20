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
import { dirname, join, relative, resolve } from "node:path";

// The test runners must not skip tests silently. Prove each guard in the repo's real
// configs against throwaway fixtures: a committed `test.only` must fail Playwright
// under CI, and vitest must collect every test-file shape under `src/`.
const repo = resolve(import.meta.dirname, "..");
const playwrightConfig = join(repo, "playwright.config.ts");
const vitestConfig = join(repo, "vitest.config.ts");

const run = (command, args, cwd, env = {}) => {
  const result = spawnSync(join(repo, "node_modules", ".bin", command), args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
  if (result.error)
    throw new Error(`${command} failed to run`, { cause: result.error });
  if (result.signal)
    throw new Error(`${command} was killed by ${result.signal}`);
  return result;
};

const fixtureRoot = await mkdtemp(join(tmpdir(), "test-runners-"));
try {
  // Fixture specs import from the repo's dependencies.
  await symlink(join(repo, "node_modules"), join(fixtureRoot, "node_modules"));

  // Playwright: a spec with `test.only` runs only itself and exits 0 unless forbidOnly is set.
  const e2eDir = join(fixtureRoot, "e2e");
  await mkdir(e2eDir);
  await writeFile(
    join(e2eDir, "playwright.config.ts"),
    `import base from ${JSON.stringify(playwrightConfig)};\n` +
      `export default { ...base, testDir: ${JSON.stringify(e2eDir)} };\n`,
  );
  await writeFile(
    join(e2eDir, "control.spec.ts"),
    'import { test } from "@playwright/test";\ntest("control", () => {});\n',
  );
  const controlRun = run(
    "playwright",
    ["test", "--config", join(e2eDir, "playwright.config.ts")],
    fixtureRoot,
    { CI: "true" },
  );
  if (controlRun.status !== 0) {
    throw new Error(
      `Playwright control fixture without test.only should pass:\n${controlRun.stdout}${controlRun.stderr}`,
    );
  }
  await writeFile(
    join(e2eDir, "only.spec.ts"),
    'import { test } from "@playwright/test";\ntest.only("only", () => {});\n',
  );
  const onlyRun = run(
    "playwright",
    ["test", "--config", join(e2eDir, "playwright.config.ts")],
    fixtureRoot,
    { CI: "true" },
  );
  // Require Playwright's own forbidOnly complaint: any other failure proves nothing.
  const onlyOutput = onlyRun.stdout + onlyRun.stderr;
  if (onlyRun.status === 0 || !onlyOutput.includes("forbidOnly")) {
    throw new Error(
      `Playwright must fail a committed test.only under CI with its forbidOnly error; set forbidOnly: !!process.env.CI (exit ${onlyRun.status}):\n${onlyOutput}`,
    );
  }
  console.log("playwright: committed test.only fails under CI");

  // Vitest: every test-file shape under src/ must be collected.
  const srcDir = join(fixtureRoot, "src");
  // Nested like the real tree, so a path-scoped exclude or narrowed glob is caught too.
  const shapes = [
    "client/a.test.ts",
    "client/b.test.tsx",
    "engine/c.spec.ts",
    "server/d.spec.tsx",
  ];
  for (const name of shapes) {
    await mkdir(dirname(join(srcDir, name)), { recursive: true });
    await writeFile(
      join(srcDir, name),
      'import { test } from "vitest";\ntest("collected", () => {});\n',
    );
  }
  const report = join(fixtureRoot, "report.json");
  const vitestRun = run(
    "vitest",
    [
      "run",
      ...["--config", vitestConfig, "--root", fixtureRoot],
      ...["--reporter=json", `--outputFile=${report}`],
    ],
    fixtureRoot,
  );
  if (vitestRun.status !== 0) {
    throw new Error(
      `vitest failed on the fixture tree:\n${vitestRun.stdout}${vitestRun.stderr}`,
    );
  }
  let collected;
  try {
    collected = JSON.parse(await readFile(report, "utf8")).testResults.map(
      (file) => relative(srcDir, file.name),
    );
  } catch {
    throw new Error(
      `vitest produced no JSON report:\n${vitestRun.stdout}${vitestRun.stderr}`,
    );
  }
  const missing = shapes.filter((name) => !collected.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `vitest did not collect ${missing.join(", ")}; widen include to src/**/*.{test,spec}.{ts,tsx}`,
    );
  }
  console.log(`vitest: collected ${shapes.join(", ")}`);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
