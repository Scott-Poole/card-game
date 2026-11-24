import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

// Doc check for the land skill's post-merge recovery path (#291). The skill is prose, so
// this pins the instructions a crashed-after-merge run depends on.
const skill = await readFile(
  new URL("../.agents/skills/land/SKILL.md", import.meta.url),
  "utf8",
);

export function recoverySection(source) {
  const match = /^## Resume after merge\n([\s\S]*?)(?=^## )/m.exec(source);
  return match?.[1];
}

export function findRecoveryDrift(source) {
  const section = recoverySection(source);
  if (section === undefined)
    return ["land has no `## Resume after merge` section"];
  const problems = [];
  const required = [
    [/`MERGED`/, "enters only for a merged PR"],
    [/PR totals/, "reads the PR totals row"],
    [/already linked/i, "skips follow-ups already linked"],
    [/filing and cleanup/i, "resumes only at filing and cleanup"],
    [/Never push, review, or merge/, "forbids push, review and merge"],
  ];
  for (const [pattern, why] of required) {
    if (!pattern.test(section))
      problems.push(`recovery section no longer ${why}`);
  }
  if (
    !/closed[^.\n]*unless[^.\n]*merged/i.test(
      source.split(/^## Resume after merge/m)[0] ?? "",
    )
  ) {
    problems.push(
      "step 1 no longer routes merged PRs with incomplete totals to recovery",
    );
  }
  return problems;
}

assert.deepEqual(findRecoveryDrift(skill), []);

// The check must bite: each deletion below has to be reported.
for (const [label, mutate] of [
  [
    "section removed",
    (s) => s.replace(/^## Resume after merge[\s\S]*?(?=^## )/m, ""),
  ],
  [
    "push ban removed",
    (s) => s.replace("Never push, review, or merge", "Push freely"),
  ],
  ["totals read removed", (s) => s.replaceAll("PR totals", "totals")],
  ["skip-linked removed", (s) => s.replace("already linked", "new")],
  ["scope widened", (s) => s.replace(/filing and cleanup/i, "everything")],
  ["step 1 unrouted", (s) => s.replace("unless it is **merged**", "always")],
]) {
  assert.notDeepEqual(findRecoveryDrift(mutate(skill)), [], label);
}
console.log("land recovery doc checks passed");
