// The review's findings are a closed, structured document, never prose. The model picks
// categories, metrics, windows, issue numbers and proposals from the lists below; this
// module validates that choice and renders every word and every number itself, so nothing
// the model "writes" can carry source text onto a public issue.
import { round } from "./lib.mjs";

export class FindingsError extends Error {}

const maxFindings = 8;
const maxEvidence = 4;
const maxIssues = 5;
const maxSkills = 3;
export const maxTickets = 3;

export const categories = {
  "routing-share-off-target": {
    title: "Routing share off target",
    sentence: "The share of implement threads run on Claude is away from its target.",
  },
  "failed-runs": {
    title: "Failed runs",
    sentence: "Runs failed often enough to cost real work.",
  },
  "usage-limit-failures": {
    title: "Usage limit failures",
    sentence: "Runs failed because a provider usage limit was reached.",
  },
  "review-churn": {
    title: "Review churn",
    sentence: "Pull requests needed many threads or review rounds before they landed.",
  },
  "gate-cost": {
    title: "Gate cost",
    sentence: "The full local gate fails or runs often enough to cost real time.",
  },
  "context-growth": {
    title: "Context growth",
    sentence: "Threads reach very large contexts or take many turns.",
  },
  "tick-noop": {
    title: "Tick no-ops",
    sentence: "Tick runs that launch nothing still cost time and money.",
  },
  "spend": {
    title: "Claude cost",
    sentence: "Claude spend is concentrated enough to deserve a look.",
  },
  "skill-unused": {
    title: "Unused skills",
    sentence: "Some repo skills were never loaded in the window.",
  },
  "skill-single-provider": {
    title: "Single-provider skills",
    sentence: "Some repo skills are loaded by one provider only.",
  },
  "hygiene-leftovers": {
    title: "Hygiene leftovers",
    sentence: "Worktrees, branches or threads were left behind after their work ended.",
  },
  "schedule-drift": {
    title: "Schedule drift",
    sentence: "The scheduled tasks no longer match what the docs say.",
  },
  "doc-drift": {
    title: "Factual drift",
    sentence: "A statement in AGENTS.md, a skill or the agent docs no longer matches a measured behaviour.",
  },
};

export const proposals = {
  "add-script-check": {
    sentence: "Add a deterministic script check for this measure to the full gate.",
    acceptance: [
      "A script check for this measure exists and `scripts/gates.mjs` runs it.",
      "The check fails on a fixture that reproduces the finding.",
    ],
  },
  "add-lint-rule": {
    sentence: "Add a lint rule that rejects the pattern behind this measure.",
    acceptance: [
      "A lint rule for the pattern exists and `pnpm lint` exits 0 on the repo.",
      "The rule fails on a fixture that reproduces the finding.",
    ],
  },
  "add-gate": {
    sentence: "Add a gate step that catches this earlier than a person would.",
    acceptance: [
      "`scripts/gates.mjs` lists the new step and `pnpm check` runs it.",
      "The step fails on a fixture that reproduces the finding.",
    ],
  },
  "fix-doc-drift": {
    sentence: "Correct the document so it states what the measure shows.",
    acceptance: [
      "The named document states the measured value or behaviour.",
      "`pnpm check` exits 0, including the doc link gate.",
    ],
  },
  "adjust-routing": {
    sentence: "Adjust model or provider routing toward the target.",
    acceptance: [
      "The routing configuration changes and `bash .agents/skills/delegate/route.sh plan` reflects it.",
      "The next process review reports the measure closer to its target.",
    ],
  },
  "clean-hygiene": {
    sentence: "Remove the leftovers and add a sweep that keeps them from returning.",
    acceptance: [
      "`git worktree list` and `git branch --merged origin/main` show none of the measured leftovers.",
      "A sweep or check keeps the count at zero.",
    ],
  },
  "prune-skill": {
    sentence: "Remove the skill or trim its description so it stops costing context.",
    acceptance: [
      "The named skill is removed or its description is shorter.",
      "`pnpm check` exits 0 and `skills-lock.json` still matches the skills directory.",
    ],
  },
  investigate: {
    sentence: "Investigate the cause before choosing a fix.",
    acceptance: null,
  },
};

const percent = (value) => `${round(value * 100, 1)}%`;
const units = {
  count: (value) => String(Math.round(value)),
  number: (value) => String(round(value, 2)),
  share: percent,
  hours: (value) => `${round(value, 2)} h`,
  usd: (value) => `${round(value, 2)} USD`,
};

// Each metric names the report node that says whether it was measured, and how to read it.
export const metrics = {
  "routing-share-achieved": {
    label: "Claude share of implement threads",
    unit: "share",
    node: (r) => r.mix,
    read: (r) => r.mix.claudeShare.achieved,
  },
  "routing-share-target": {
    label: "Claude share target",
    unit: "share",
    node: (r) => r.mix,
    read: (r) => r.mix.claudeShare.target,
  },
  "failed-runs": {
    label: "Failed runs",
    unit: "count",
    node: (r) => r.runs,
    read: (r) => r.runs.failedTotal,
  },
  "usage-limit-failures": {
    label: "Failed runs from usage limits",
    unit: "count",
    node: (r) => r.runs,
    read: (r) => r.runs.failedToUsageLimit,
  },
  "review-threads-per-pr-max": {
    label: "Most threads on one PR",
    unit: "count",
    node: (r) => r.reviews,
    read: (r) => r.reviews.threadsPerPr.max,
  },
  "review-threads-per-pr-mean": {
    label: "Mean threads per PR",
    unit: "number",
    node: (r) => r.reviews,
    read: (r) => r.reviews.threadsPerPr.mean,
  },
  "gate-failed-share": {
    label: "Gate failure share",
    unit: "share",
    node: (r) => r.gate,
    read: (r) => r.gate.failedShare,
  },
  "gate-runs": {
    label: "Gate runs",
    unit: "count",
    node: (r) => r.gate,
    read: (r) => r.gate.runs,
  },
  "gate-wall-hours": {
    label: "Gate wall clock",
    unit: "hours",
    node: (r) => r.gate,
    read: (r) => r.gate.wallMinutes / 60,
  },
  "context-over-200k-threads": {
    label: "Threads peaking at 200k tokens or more",
    unit: "count",
    node: (r) => r.context,
    read: (r) => r.context.atLeast200kTokens,
  },
  "context-half-window-threads": {
    label: "Threads at half their context window or more",
    unit: "count",
    node: (r) => r.context,
    read: (r) => r.context.atLeastHalfWindow,
  },
  "implement-turns-p90": {
    label: "Provider turns per implement thread, p90",
    unit: "number",
    node: (r) => r.context.implement,
    read: (r) => r.context.implement.turnsPerThread.p90,
  },
  "tick-noop-share": {
    label: "Tick runs that launched nothing",
    unit: "share",
    node: (r) => r.context.tick,
    read: (r) => r.context.tick.noopShare,
  },
  "spend-usd": {
    label: "Claude cost",
    unit: "usd",
    node: (r) => r.cost,
    read: (r) => r.cost.totalUsd,
  },
  "codex-days-at-limit": {
    label: "Days at the Codex limit",
    unit: "count",
    node: (r) => r.codexLimits,
    read: (r) => r.codexLimits.daysAtLimit,
  },
  "skills-zero-use": {
    label: "Skills with no loads",
    unit: "count",
    node: (r) => r.skills.inventory,
    read: (r) => r.skills.zeroUse.length,
  },
  "skills-single-provider": {
    label: "Skills loaded by one provider only",
    unit: "count",
    node: (r) => r.skills.inventory,
    read: (r) => r.skills.singleProvider.length,
  },
  "worktrees-leftover": {
    label: "Leftover worktrees",
    unit: "count",
    node: (r) => r.hygiene.worktrees,
    read: (r) => r.hygiene.worktrees.total,
  },
  "branches-leftover": {
    label: "Leftover local branches",
    unit: "count",
    node: (r) => r.hygiene.branches,
    read: (r) => r.hygiene.branches.total,
  },
  "threads-unarchived": {
    label: "Unarchived threads",
    unit: "count",
    node: (r) => r.hygiene.threads,
    read: (r) => r.hygiene.threads.unarchived,
  },
  "schedule-enabled-tasks": {
    label: "Enabled scheduled tasks",
    unit: "count",
    node: (r) => r.schedule,
    read: (r) => r.schedule.enabled,
  },
};

const windows = ["week", "all"];
const repeatedWords = { yes: "yes", no: "no", "no-previous": "no previous report" };
const impacts = ["money", "hours", "failed-work", "none"];
const labels = ["needs-triage"];

// ---------------------------------------------------------------- validation

function fail(where, rule) {
  // Names the field and the rule, never the offending value.
  throw new FindingsError(`invalid findings: ${where} ${rule}`);
}

function object(value, where, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(where, "is not an object");
  const present = Object.keys(value);
  if (present.some((key) => !keys.includes(key))) fail(where, "has a key outside the format");
  if (keys.some((key) => !present.includes(key))) fail(where, "lacks a required key");
  return value;
}

function list(value, where, min, max) {
  if (!Array.isArray(value)) fail(where, "is not a list");
  if (value.length < min || value.length > max) fail(where, "has the wrong number of entries");
  return value;
}

function choice(value, where, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) fail(where, "is not in the closed list");
  return value;
}

// Parses and validates a findings document. `skillNames` is the repo's own skill list.
export function parseFindings(text, skillNames) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FindingsError("invalid findings: the file is not the structured findings format");
  }
  const document = object(raw, "document", ["findings", "tickets"]);
  const findings = list(document.findings, "findings", 0, maxFindings).map((entry, index) => {
    const where = `findings[${index}]`;
    const item = object(entry, where, [
      "category",
      "evidence",
      "issues",
      "repeated",
      "impact",
      "proposal",
      "skills",
    ]);
    return {
      category: choice(item.category, `${where}.category`, Object.keys(categories)),
      evidence: list(item.evidence, `${where}.evidence`, 1, maxEvidence).map((evidence, at) => {
        const inner = object(evidence, `${where}.evidence[${at}]`, ["metric", "window"]);
        return {
          metric: choice(inner.metric, `${where}.evidence[${at}].metric`, Object.keys(metrics)),
          window: choice(inner.window, `${where}.evidence[${at}].window`, windows),
        };
      }),
      issues: list(item.issues, `${where}.issues`, 0, maxIssues).map((issue) => {
        if (!Number.isInteger(issue) || issue < 1 || issue > 999999) {
          fail(`${where}.issues`, "holds something other than an issue number");
        }
        return issue;
      }),
      repeated: choice(item.repeated, `${where}.repeated`, Object.keys(repeatedWords)),
      impact: choice(item.impact, `${where}.impact`, impacts),
      proposal: choice(item.proposal, `${where}.proposal`, Object.keys(proposals)),
      skills: list(item.skills, `${where}.skills`, 0, maxSkills).map((skill) =>
        choice(skill, `${where}.skills`, skillNames),
      ),
    };
  });
  const seen = new Set();
  const tickets = list(document.tickets, "tickets", 0, maxTickets).map((entry, index) => {
    const where = `tickets[${index}]`;
    const item = object(entry, where, ["finding", "label"]);
    if (!Number.isInteger(item.finding) || item.finding < 1 || item.finding > findings.length) {
      fail(`${where}.finding`, "does not point at a finding");
    }
    if (seen.has(item.finding)) fail(where, "repeats a finding");
    seen.add(item.finding);
    const label = choice(item.label, `${where}.label`, labels);
    return { finding: item.finding, label };
  });
  return { findings, tickets };
}

// ----------------------------------------------------------------- rendering

function measure(metric, window, reports) {
  const definition = metrics[metric];
  const report = reports[window];
  let value;
  try {
    const node = definition.node(report);
    if (node === undefined || node === null || node.available === false) return "unavailable";
    value = definition.read(report);
  } catch {
    return "unavailable";
  }
  return typeof value === "number" && Number.isFinite(value) ? units[definition.unit](value) : "no data";
}

function evidenceLines(finding, reports) {
  return finding.evidence.map(
    (item) => `- ${metrics[item.metric].label} (${item.window}): ${measure(item.metric, item.window, reports)}`,
  );
}

function detailLines(finding) {
  const lines = [];
  if (finding.issues.length > 0) lines.push(`- Issues: ${finding.issues.map((n) => `#${n}`).join(", ")}`);
  if (finding.skills.length > 0) lines.push(`- Skills: ${finding.skills.map((s) => `\`${s}\``).join(", ")}`);
  lines.push(`- Repeated: ${repeatedWords[finding.repeated]}`);
  lines.push(`- Impact: ${finding.impact}`);
  lines.push(`- Proposed: ${proposals[finding.proposal].sentence}`);
  return lines;
}

// `reports` is { week, all }: the collector's own JSON reports.
export function renderFindings(document, reports) {
  const out = [
    "### Findings\n",
    "Every line below is generated from a closed vocabulary; the figures are read from this review's own tables.\n",
  ];
  if (document.findings.length === 0) out.push("No finding met the bar this week.\n");
  document.findings.forEach((finding, index) => {
    const category = categories[finding.category];
    out.push(
      [
        `${index + 1}. **${category.title}.** ${category.sentence}`,
        ...[...evidenceLines(finding, reports), ...detailLines(finding)].map((line) => `   ${line}`),
      ].join("\n") + "\n",
    );
  });
  const filed = document.tickets.map((ticket) => `#${ticket.finding} (${ticket.label})`);
  out.push(
    `Tickets: ${document.tickets.length} of ${maxTickets} allowed${filed.length > 0 ? `, for findings ${filed.join(", ")}` : ""}.\n`,
  );
  return `${out.join("\n")}`;
}

// One part of a follow-up ticket: its title, its label or its body.
export function renderTicket(document, number, researchIssue, part, reports) {
  const ticket = document.tickets[number - 1];
  if (ticket === undefined) fail("ticket", "does not exist");
  const finding = document.findings[ticket.finding - 1];
  const category = categories[finding.category];
  const proposal = proposals[finding.proposal];
  if (part === "title") return `process review: ${category.title.toLowerCase()}\n`;
  if (part === "label") return `${ticket.label}\n`;
  const acceptance = proposal.acceptance ?? [];
  return [
    "## Finding",
    "",
    category.sentence,
    "",
    "## Evidence",
    "",
    ...evidenceLines(finding, reports),
    ...detailLines(finding),
    "",
    ...(acceptance.length > 0
      ? ["## Acceptance criteria", "", ...[...acceptance, "`CI=true pnpm check` exits 0."].map((line) => `- [ ] ${line}`), ""]
      : []),
    `Refs #${researchIssue}`,
    "",
  ].join("\n");
}
