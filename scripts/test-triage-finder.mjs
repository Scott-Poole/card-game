import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const dir = mkdtempSync(join(tmpdir(), "triage-"));
try {
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh
[ "$1" = api ] && [ "$2" = --paginate ] && [ "$3" = --jq ] && [ "$4" = '.[] | @json' ] && [ "$5" = 'repos/Scott-Poole/card-game/issues?state=open&per_page=100' ] || exit 9
[ -z "$GH_FAIL" ] || exit 7
cat "$FIXTURE"
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  const configFile = join(dir, "config.json");
  writeFileSync(
    configFile,
    JSON.stringify({ trustedAuthors: ["Scott-Poole"] }),
  );
  const fixture = join(dir, "issues.json");
  const issue = (number, author, labels, created_at) => ({
    number,
    user: { login: author },
    labels: labels.map((name) => ({ name })),
    created_at,
  });
  const run = (issues, states, extraEnv = {}) => {
    const stateFile = join(dir, "states.json");
    if (states) writeFileSync(stateFile, JSON.stringify(states));
    writeFileSync(
      fixture,
      issues.map((issue) => JSON.stringify(issue)).join("\n"),
    );
    return spawnSync(
      process.execPath,
      [
        resolve("scripts/triage-finder.mjs"),
        ...(states ? ["--grills", stateFile] : []),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          FIXTURE: fixture,
          TRIAGE_CONFIG: configFile,
          ...extraEnv,
        },
      },
    );
  };
  assert.equal(
    run([
      issue(2, "stranger", ["needs-triage"], "2020-01-01"),
      issue(1, "Scott-Poole", ["needs-triage"], "2021-01-01"),
    ]).stdout,
    "TRIAGE 1\n",
  );
  console.log("PASS trusted authors");
  for (const labels of [
    ["backlog"],
    ["backlog", "needs-triage"],
    ["backlog", "grilling"],
  ]) {
    const result = run([issue(10, "Scott-Poole", labels, "2020-01-01")]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  }
  console.log("PASS backlog excluded even with conflicting labels");
  assert.equal(
    run([issue(11, "Scott-Poole", ["enhancement"], "2020-01-01")]).stdout,
    "TRIAGE 11\n",
  );
  for (const label of [
    "ready-for-agent",
    "in-progress",
    "planning",
    "research",
    "wontfix",
  ]) {
    assert.equal(
      run([issue(11, "Scott-Poole", [label], "2020-01-01")]).stdout,
      "",
    );
  }
  const pending = issue(
    3,
    "Scott-Poole",
    ["needs-triage", "grilling"],
    "2020-01-01",
  );
  assert.equal(run([pending], { 3: "live" }).stdout, "");
  assert.equal(run([pending]).stdout, "CHECK 3\n");
  assert.equal(run([pending], { 3: "missing" }).stdout, "STALE 3\n");
  assert.notEqual(run([pending], {}).status, 0);
  assert.notEqual(run([pending], { 3: "failed" }).status, 0);
  assert.equal(run([pending], { 3: "terminal-failed" }).stdout, "STALE 3\n");
  const pr = {
    ...issue(8, "Scott-Poole", ["needs-triage"], "2020-01-01"),
    pull_request: {},
  };
  assert.equal(run([pr]).stdout, "");
  assert.equal(run([]).stdout, "");
  assert.equal(
    run([{ ...pending, labels: [{ name: "grilling" }] }], { 3: "missing" })
      .stdout,
    "STALE 3\n",
  );
  assert.equal(run([{ ...pending, user: null }]).stdout, "");
  assert.notEqual(run([], undefined, { GH_FAIL: "1" }).status, 0);
  assert.equal(run([], undefined, { GH_FAIL: "1" }).stdout, "");
  assert.equal(
    run([
      issue(7, "Scott-Poole", ["needs-triage"], "2020-01-01T00:00:00Z"),
      issue(6, "Scott-Poole", ["needs-triage"], "2020-01-01T00:00:00Z"),
    ]).stdout,
    "TRIAGE 6\nTRIAGE 7\n",
  );
  const ordered = run([
    issue(9, "Scott-Poole", ["needs-triage"], "2022-01-01"),
    issue(4, "Scott-Poole", ["needs-triage"], "2020-01-01"),
  ]);
  assert.equal(ordered.status, 0);
  assert.equal(ordered.stdout, "TRIAGE 4\nTRIAGE 9\n");
  console.log(
    "PASS grilling excluded, stale grilling, unknown fails closed, ordering, empty",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
