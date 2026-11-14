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
  "test:browser",
];
for (const gate of gates) {
  const result = spawnSync("pnpm", [gate], {
    stdio: "inherit",
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// A gate that leaks git's hook environment into `git init` flips the real repo to
// core.bare=true in the shared config, which breaks the main checkout and every new
// worktree. Linked worktrees still report themselves non-bare, so read the setting.
const bare = spawnSync(
  "git",
  ["config", "--local", "--type=bool", "--get", "core.bare"],
  {
    encoding: "utf8",
    env: environment,
  },
);
if (bare.stdout.trim() === "true") {
  console.error(
    "check: the repository now reports core.bare=true; a gate re-initialised it.\n" +
      "Repair with `git config --local core.bare false` and find the gate that ran `git init` with GIT_DIR set.",
  );
  process.exit(1);
}
