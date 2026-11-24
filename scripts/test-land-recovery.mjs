import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

// Doc check for the land skill's post-merge recovery path (#291). The skill is prose, so
// this pins the instructions a crashed-after-merge run depends on: where it enters, what
// it may do, and what it must not.
const skill = await readFile(
  new URL("../.agents/skills/land/SKILL.md", import.meta.url),
  "utf8",
);

const heading = "## Resume after merge";

export function section(source) {
  return /^## Resume after merge\n([\s\S]*?)(?=^## )/m.exec(source)?.[1];
}

// GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens.
function slug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replaceAll(" ", "-");
}

export function findRecoveryDrift(source) {
  const body = section(source);
  if (body === undefined) return [`land has no \`${heading}\` section`];
  const problems = [];
  const required = [
    [
      /Land resumes there, and only there: \*\*filing and cleanup\*\*/,
      "resumes only at filing and cleanup",
    ],
    [/`land <n>`/, "names the manual re-entry"],
    [
      /\*\*settled\*\*[\s\S]*\*\*pending\*\*/,
      "defines settled and pending follow-ups",
    ],
    [
      /holds counters and `<state>` only/,
      "says links live in Follow-ups, not the totals row",
    ],
    [/no verdict: stop/i, "stops when there is no verdict"],
    [/--json mergeCommit/, "looks up the squash commit"],
    [
      /`merged; filing complete` and no follow-up is pending, stop/,
      "stops when filing is complete",
    ],
    [
      /missing totals row does not stop recovery/i,
      "handles a missing totals row",
    ],
    [/Skip every settled follow-up/, "skips settled follow-ups"],
    [/--state all/, "searches closed issues too"],
    [
      /nam(?:es|ing)\s+\*\*that\*\*\s+follow-up's finding or `file:line`/,
      "matches per follow-up",
    ],
    [
      /proves nothing about any other follow-up/,
      "refuses a PR-wide match as proof",
    ],
    [/Clean up \(step 4\.5\)/, "ends with cleanup"],
    [/Never push, review, or merge/, "forbids push, review and merge"],
    [/no `cross-review`/, "forbids cross-review"],
    [/creates no PR checkout or branch/, "forbids a PR checkout"],
    [/Done when no follow-up is pending/, "states a done condition"],
  ];
  for (const [pattern, why] of required) {
    if (!pattern.test(body)) problems.push(`recovery section no longer ${why}`);
  }
  const intro = source.split(heading)[0] ?? "";
  const link = /\[Resume after merge\]\(#([^)]+)\)/.exec(intro);
  if (link === null)
    problems.push("step 1 no longer links to the recovery section");
  else if (link[1] !== slug("Resume after merge")) {
    problems.push(`step 1 links to #${link[1]}, not the section's anchor`);
  }
  if (!/If `state` is `MERGED`, take \[Resume after merge\]/.test(intro)) {
    problems.push("step 1 no longer routes every merged PR to recovery");
  }
  if (
    !/`pending: file after merge`, with the reviewer's acceptance criteria/.test(
      source,
    )
  ) {
    problems.push(
      "step 4.4 no longer records pending follow-ups with their criteria",
    );
  }
  return problems;
}

assert.deepEqual(findRecoveryDrift(skill), []);

// A reworded but equivalent heading body must not matter: only the contract is pinned.
assert.equal(slug("Resume after merge"), "resume-after-merge");

// The check must bite: each mutation has to be reported.
const mutations = [
  [
    "section removed",
    (s) => s.replace(/^## Resume after merge[\s\S]*?(?=^## )/m, ""),
  ],
  [
    "push ban removed",
    (s) => s.replace("Never push, review, or merge", "Push freely"),
  ],
  [
    "cross-review ban removed",
    (s) => s.replace("no `cross-review`", "cross-review"),
  ],
  [
    "checkout ban removed",
    (s) => s.replace("creates no PR checkout or branch", "may create a branch"),
  ],
  ["scope widened", (s) => s.replace("**filing and cleanup**", "everything")],
  [
    "skip-settled removed",
    (s) => s.replace("Skip every settled follow-up", "Refile everything"),
  ],
  [
    "PR-wide match accepted",
    (s) =>
      s.replace("proves nothing about any other follow-up", "counts as filed"),
  ],
  ["closed issues ignored", (s) => s.replace("--state all", "--state open")],
  [
    "squash lookup removed",
    (s) => s.replace("--json mergeCommit", "--json state"),
  ],
  ["cleanup removed", (s) => s.replace("Clean up (step 4.5)", "Done")],
  [
    "done line removed",
    (s) => s.replace("Done when no follow-up is pending", "Whenever"),
  ],
  [
    "complete-stop removed",
    (s) => s.replace("and no follow-up is pending, stop", "continue"),
  ],
  [
    "links moved to the row",
    (s) =>
      s.replace(
        "holds counters and `<state>` only",
        "holds counters and links",
      ),
  ],
  [
    "wrong anchor",
    (s) => s.replace("(#resume-after-merge)", "(#resume-after-merger)"),
  ],
  [
    "merged unrouted",
    (s) =>
      s.replace("If `state` is `MERGED`, take", "If `state` is `OPEN`, take"),
  ],
  [
    "pending marker removed",
    (s) =>
      s.replace(
        "`pending: file after merge`, with the reviewer's",
        "notes with the",
      ),
  ],
];
for (const [label, mutate] of mutations) {
  const mutated = mutate(skill);
  assert.notEqual(mutated, skill, `mutation did not apply: ${label}`);
  assert.notDeepEqual(findRecoveryDrift(mutated), [], label);
}
console.log("land recovery doc checks passed");
