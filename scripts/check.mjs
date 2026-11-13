import { spawnSync } from "node:child_process";

// Git hooks export local repository paths. Foreign scratch repositories in the
// regression suites must resolve their own Git directory and index.
const gitEnv = spawnSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
});
if (gitEnv.error) throw gitEnv.error;
if (gitEnv.status !== 0) process.exit(gitEnv.status ?? 1);
const environment = { ...process.env, CI: "true" };
for (const name of gitEnv.stdout.trim().split("\n")) {
  delete environment[name];
}

const gates = [
  "typecheck",
  "lint",
  "format:check",
  "test",
  "test:guardrail",
  "test:queue",
  "test:boundaries",
];
for (const gate of gates) {
  const result = spawnSync("pnpm", [gate], {
    stdio: "inherit",
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
