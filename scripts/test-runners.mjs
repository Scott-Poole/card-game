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

// The test runners must not skip tests silently. Prove each guard in the repo's real
// configs against throwaway fixtures: a committed `test.only` must fail Playwright
// under CI, and vitest must collect every test-file shape under `src/`.
const repo = resolve(import.meta.dirname, "..");
const playwrightConfig = join(repo, "playwright.config.ts");
const vitestConfig = join(repo, "vitest.config.ts");

const run = (command, args, cwd, env = {}) =>
  spawnSync(join(repo, "node_modules", ".bin", command), args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

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
  if (onlyRun.status === 0) {
    throw new Error(
      `Playwright exited 0 for a committed test.only under CI; set forbidOnly: !!process.env.CI:\n${onlyRun.stdout}`,
    );
  }
  console.log("playwright: committed test.only fails under CI");

  // Vitest: every test-file shape under src/ must be collected.
  const srcDir = join(fixtureRoot, "src");
  await mkdir(srcDir);
  const shapes = ["a.test.ts", "b.test.tsx", "c.spec.ts", "d.spec.tsx"];
  for (const name of shapes) {
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
  let collected;
  try {
    collected = JSON.parse(await readFile(report, "utf8")).testResults.map(
      (file) => file.name.slice(srcDir.length + 1),
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
