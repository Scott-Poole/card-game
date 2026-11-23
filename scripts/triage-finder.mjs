// T3 owns thread existence checks; --grills supplies confirmed ticket states.
import { execFileSync } from "node:child_process";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
const config = JSON.parse(
  readFileSync(
    process.env.TRIAGE_CONFIG ??
      new URL("../.agents/skills/tick/config.json", import.meta.url),
    "utf8",
  ),
);
if (
  !Array.isArray(config.trustedAuthors) ||
  !config.trustedAuthors.every((author) => typeof author === "string")
)
  throw new Error("Invalid trust policy");
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--grills"))
  throw new Error("Usage: triage-finder.mjs [--grills verified-states.json]");
const grills = args.length ? JSON.parse(readFileSync(args[1], "utf8")) : null;
const pages = execFileSync(
  "gh",
  [
    "api",
    "--paginate",
    "--jq",
    ".[] | @json",
    "repos/Scott-Poole/card-game/issues?state=open&per_page=100",
  ],
  { encoding: "utf8" },
);
const issues = pages.trim()
  ? pages
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
  : [];
const output = [];
for (const issue of issues
  .filter(
    (issue) =>
      !issue.pull_request && config.trustedAuthors.includes(issue.user?.login),
  )
  .sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.number - b.number,
  )) {
  if (issue.labels.some((label) => label.name === "backlog")) continue;
  if (issue.labels.some((label) => label.name === "grilling")) {
    if (grills === null) output.push(`CHECK ${issue.number}`);
    else if (
      grills[issue.number] === "missing" ||
      grills[issue.number] === "terminal-failed"
    )
      output.push(`STALE ${issue.number}`);
    else if (grills[issue.number] !== "live")
      throw new Error(`Unverified grilling ticket #${issue.number}`);
  } else if (
    issue.labels.some((label) => label.name === "needs-triage") ||
    !issue.labels.some(({ name }) =>
      [
        "ready-for-agent",
        "backlog",
        "grilling",
        "in-progress",
        "planning",
        "research",
        "wontfix",
      ].includes(name),
    )
  )
    output.push(`TRIAGE ${issue.number}`);
}
if (output.length) process.stdout.write(`${output.join("\n")}\n`);
