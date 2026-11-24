// Renders the report as JSON or markdown tables, and refuses to publish anything that
// could carry source text: every string must be a short single-line token, and the final
// text must pass the publish rules in lib.mjs.
import { assertPublishable, round } from "./lib.mjs";

const maxLabel = 64;

function checkValue(value) {
  if (typeof value === "string") {
    if (value.length > maxLabel || value.includes("\n")) {
      throw new Error("refusing to publish: a label is not a short single-line token");
    }
    assertPublishable(value);
  } else if (Array.isArray(value)) {
    value.forEach(checkValue);
  } else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      checkValue(key);
      checkValue(inner);
    }
  } else if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("refusing to publish: a number is not finite");
  }
}

const dash = "-";
function cell(value, digits = 2) {
  if (value === null || value === undefined) return dash;
  if (typeof value === "number") return String(round(value, digits));
  return String(value);
}
function percent(value) {
  return value === null || value === undefined ? dash : `${round(value * 100, 1)}%`;
}
function table(headers, rows) {
  if (rows.length === 0) return "_none_\n";
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((value) => cell(value)).join(" | ")} |`),
  ];
  return `${lines.join("\n")}\n`;
}
function section(title, body) {
  return `### ${title}\n\n${body}\n`;
}
function off(part) {
  return `unavailable (${part.reason})\n`;
}

export function renderMarkdown(report) {
  const window = report.window;
  const scope = window.all
    ? `all time, until ${window.until}`
    : `last ${window.days} days, ${window.since} to ${window.until}`;
  const out = [`## Process review data\n\nScope: ${scope}.\n`];
  const cover = report.coverage;
  out.push(
    section(
      "Coverage",
      table(
        ["source", "available", "found", "linked to T3", "outside T3"],
        [
          ["T3 database", cover.t3.available, cover.t3.threads, dash, dash],
          ["Claude Code transcripts", cover.claude.available, cover.claude.transcripts, cover.claude.linkedToT3, cover.claude.outsideT3],
          ["Codex sessions", cover.codex.available, cover.codex.sessions, cover.codex.linkedToT3, cover.codex.outsideT3],
          ["git", cover.git.available, dash, dash, dash],
        ],
      ) + `\nGaps:\n\n${cover.gaps.map((gap) => `- ${gap}`).join("\n")}\n`,
    ),
  );

  const inventory = report.skills.inventory;
  out.push(
    section(
      "Skills",
      `${inventory.total} skills, ${inventory.modelInvocable} model-invocable carrying ${inventory.descriptionChars} description characters (about ${inventory.approxTokens} tokens in every child), ${inventory.userInvoked} user-invoked. Loads are Skill tool calls and SKILL.md reads; threads counts distinct threads or sessions.\n\n` +
        table(
          ["skill", "invocation", "claude loads", "claude threads", "codex loads", "codex threads", "opencode loads", "opencode threads", "total threads"],
          report.skills.rows.map((row) => [
            row.skill,
            row.invocation,
            row.claudeAgent.loads,
            row.claudeAgent.threads,
            row.codex.loads,
            row.codex.threads,
            row.opencode.loads,
            row.opencode.threads,
            row.total.threads,
          ]),
        ) +
        `\nZero-use: ${report.skills.zeroUse.join(", ") || "none"}.\n\nLoaded by one provider only: ${report.skills.singleProvider.join(", ") || "none"}.\n\nLoads of names not in this repo's skills: ${report.skills.outsideRepoLoads}.\n`,
    ),
  );

  out.push(
    section(
      "Mix by role and provider",
      table(
        ["role", "provider", "threads", "runs", "run minutes"],
        report.mix.rows.map((row) => [row.role, row.provider, row.threads, row.runs, row.runMinutes]),
      ) +
        `\nclaudeShare achieved ${percent(report.mix.claudeShare.achieved)} against target ${cell(report.mix.claudeShare.target)} (${report.mix.claudeShare.implementClaudeThreads} Claude and ${report.mix.claudeShare.implementCodexThreads} Codex implement threads). Threads with no recognised role: ${report.mix.unclassifiedThreads}.\n`,
    ),
  );

  const runs = report.runs;
  out.push(
    section(
      "Runs and failures",
      runs.available === false
        ? off(runs)
        : table(
            ["provider", "runs", "completed", "failed", "median min", "p90 min", "max min"],
            runs.byProvider.map((row) => [row.provider, row.runs, row.completed, row.failed, row.duration.median, row.duration.p90, row.duration.max]),
          ) +
            `\nFailed runs: ${runs.failedTotal}, of which usage_limit: ${runs.failedToUsageLimit}.\n\n` +
            table(["provider", "failure class", "runs"], runs.failedByProvider.map((row) => [row.provider, row.class, row.runs])) +
            "\n" +
            table(["model", "runs"], runs.models.map((row) => [row.model, row.runs])),
    ),
  );

  const reviews = report.reviews;
  out.push(
    section(
      "Review rounds per PR",
      `${reviews.prs} PRs. Threads per PR: mean ${cell(reviews.threadsPerPr.mean)}, median ${cell(reviews.threadsPerPr.median)}, p90 ${cell(reviews.threadsPerPr.p90)}, max ${cell(reviews.threadsPerPr.max)}. Review threads per PR: mean ${cell(reviews.reviewThreadsPerPr.mean)}, max ${cell(reviews.reviewThreadsPerPr.max)}.\n\n` +
        table(["PR", "threads", "review threads", "gate runs"], reviews.top.map((row) => [`#${row.pr}`, row.threads, row.reviewThreads, row.gateRuns])),
    ),
  );

  const gate = report.gate;
  out.push(
    section(
      "Gate cost (pnpm check)",
      `${gate.runs} runs (${gate.passed} passed, ${gate.failed} failed, ${gate.other} other), failure share ${percent(gate.failedShare)}, wall clock ${cell(gate.wallMinutes / 60)} h (${cell(gate.wallMinutes)} min). Commands mentioning pnpm check anywhere: ${gate.mentionRuns} (${gate.mentionFailed} failed). Per run: median ${cell(gate.duration.median)} min, p90 ${cell(gate.duration.p90)} min. Runs per PR: mean ${cell(gate.perPr.mean)}, max ${cell(gate.perPr.max)}. Outside T3: ${gate.outsideT3Runs} runs.\n`,
    ),
  );

  const context = report.context;
  out.push(
    section(
      "Context and turns",
      table(
        ["provider", "threads with usage", "median tokens", "p90 tokens", "max tokens", "outside T3 max"],
        context.peakTokens.map((row) => [row.provider, row.threads, row.median, row.p90, row.max, row.outsideT3Max]),
      ) +
        `\nThreads peaking at 200k tokens or more: ${context.atLeast200kTokens}; at half their context window or more: ${context.atLeastHalfWindow}.\n\nImplement threads (${context.implement.threads}): runs per thread median ${cell(context.implement.runsPerThread.median)}, p90 ${cell(context.implement.runsPerThread.p90)}, max ${cell(context.implement.runsPerThread.max)}; provider turns per thread median ${cell(context.implement.turnsPerThread.median)}, p90 ${cell(context.implement.turnsPerThread.p90)}.\n\nTick: ${context.tick.threads} threads, ${context.tick.runs} runs, ${context.tick.noopRuns} launched nothing (${percent(context.tick.noopShare)}), run minutes median ${cell(context.tick.runMinutes.median)}, Claude cost ${cell(context.tick.usd)} USD (${cell(context.tick.usdPerRun)} per run).\n`,
    ),
  );

  const cost = report.cost;
  out.push(
    section(
      "Claude cost (transcripts)",
      cost.available === false
        ? off(cost)
        : `${cost.sessions} sessions, ${cell(cost.totalUsd)} USD.\n\n` +
            table(["role", "sessions", "USD"], cost.byRole.map((row) => [row.role, row.sessions, row.usd])) +
            "\n" +
            table(["model", "USD"], cost.byModel.map((row) => [row.model, row.usd])),
    ),
  );

  const limits = report.codexLimits;
  out.push(
    section(
      "Codex limit samples",
      limits.available === false
        ? off(limits)
        : `${limits.samples} rate-limit samples, ${limits.atLimit} at 100% on ${limits.daysAtLimit} days, highest ${cell(limits.maxPercent)}%.\n`,
    ),
  );

  const hygiene = report.hygiene;
  out.push(
    section(
      "Hygiene",
      table(
        ["measure", "value"],
        [
          ["worktrees besides the primary", hygiene.worktrees.available ? hygiene.worktrees.total : dash],
          ["of which merged into origin/main", hygiene.worktrees.available ? hygiene.worktrees.merged : dash],
          ["of which with uncommitted changes", hygiene.worktrees.available ? hygiene.worktrees.dirty : dash],
          ["of which prunable", hygiene.worktrees.available ? hygiene.worktrees.prunable : dash],
          ["local branches besides main", hygiene.branches.available ? hygiene.branches.total : dash],
          ["of which merged into origin/main", hygiene.branches.available ? hygiene.branches.merged : dash],
          ["threads", hygiene.threads.available ? hygiene.threads.total : dash],
          ["unarchived threads", hygiene.threads.available ? hygiene.threads.unarchived : dash],
          ["unarchived and settled", hygiene.threads.available ? hygiene.threads.unarchivedSettled : dash],
          ["unarchived and older than a week", hygiene.threads.available ? hygiene.threads.unarchivedOlderThanWeek : dash],
          ["database MB", hygiene.db.available ? hygiene.db.megabytes : dash],
          ["database write-ahead log MB", hygiene.db.available ? hygiene.db.walMegabytes : dash],
        ],
      ) +
        (hygiene.branches.available
          ? `\nBranches by prefix: ${Object.entries(hygiene.branches.byPrefix).map(([name, count]) => `${name} ${count}`).join(", ") || "none"}.\n`
          : ""),
    ),
  );

  const schedule = report.schedule;
  out.push(
    section(
      "Scheduled tasks",
      schedule.available === false
        ? off(schedule)
        : `${schedule.tasks} tasks, ${schedule.enabled} enabled.\n\n` +
            table(
              ["schedule", "every hours", "thread mode", "enabled", "runs", "last status"],
              schedule.rows.map((row) => [row.kind, row.everyHours, row.threadMode, row.enabled, row.runCount, row.lastStatus]),
            ),
    ),
  );
  return `${out.join("\n").trimEnd()}\n`;
}

// The only door out: validates every value, renders, then validates the rendered text.
export function publishReport(report, format) {
  checkValue(report);
  const text = format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);
  assertPublishable(text);
  return text;
}
