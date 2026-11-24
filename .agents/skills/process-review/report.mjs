// Turns source records into the report: counts, ratios and distributions, keyed by
// closed vocabularies (providers, roles, statuses, the repo's own skill names, PR numbers).
// No free text from any source is carried into the result.
import { round, safeToken, share, summarize } from "./lib.mjs";

const providers = ["claudeAgent", "codex", "opencode"];
const minutes = (ms) => ms / 60000;
const rounded = (summary) =>
  Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [key, key === "n" ? value : round(value)]),
  );

function groupCount(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export const gaps = [
  "GitHub Actions run time and failures are not collected",
  "PR review comments and merge latency are not collected",
  "Titles, prompts and transcript text are never read",
  "OpenCode has no transcript source beyond the T3 database",
  "Outside-T3 Codex sessions give skill loads and samples only",
];

function unavailable(reason) {
  return { available: false, reason };
}

export function buildReport({ now, days, all, t3, claude, codex, skills, hygiene, target }) {
  const until = Date.parse(now);
  const since = all ? null : until - days * 86400000;
  const inWindow = (timestamp) => {
    const time = Date.parse(timestamp ?? "");
    if (!Number.isFinite(time)) return all;
    return time <= until && (all || time >= since);
  };
  const prsOf = (thread) => (thread.prs.length > 0 ? thread.prs : thread.inheritedPrs);

  const t3Threads = t3.available ? t3.threads : [];
  const threads = t3Threads.filter((thread) => inWindow(thread.createdAt));
  const roleByNative = new Map();
  for (const thread of t3Threads) {
    for (const id of thread.nativeIds) roleByNative.set(id, thread.role);
  }
  const claudeSessions = claude.available ? claude.sessions : [];
  const codexSessions = codex.available ? codex.sessions : [];
  const outsideClaude = claudeSessions.filter((session) => !session.linked);
  const outsideCodex = codexSessions.filter((session) => !session.linked);

  // ----------------------------------------------------------------- coverage
  const coverage = {
    t3: t3.available
      ? { available: true, threads: t3Threads.length }
      : { ...unavailable(t3.reason), threads: 0 },
    claude: claude.available
      ? {
          available: true,
          transcripts: claudeSessions.length,
          linkedToT3: claudeSessions.length - outsideClaude.length,
          outsideT3: outsideClaude.length,
        }
      : { ...unavailable(claude.reason), transcripts: 0, linkedToT3: 0, outsideT3: 0 },
    codex: codex.available
      ? {
          available: true,
          sessions: codexSessions.length,
          linkedToT3: codexSessions.length - outsideCodex.length,
          outsideT3: outsideCodex.length,
        }
      : { ...unavailable(codex.reason), sessions: 0, linkedToT3: 0, outsideT3: 0 },
    git: { available: hygiene.available },
    gaps,
  };

  // ------------------------------------------------------------------- skills
  const inventory = skills.skills;
  const known = new Set(inventory.map((skill) => skill.name));
  const loads = [];
  for (const thread of t3Threads) {
    for (const load of thread.skillLoads) loads.push({ ...load, who: thread.key });
  }
  for (const session of outsideClaude) {
    for (const load of session.skillLoads) loads.push({ ...load, who: session.id });
  }
  for (const session of outsideCodex) {
    for (const load of session.skillLoads) loads.push({ ...load, who: session.id });
  }
  const windowed = loads.filter((load) => inWindow(load.at));
  const skillRows = inventory.map((skill) => {
    const mine = windowed.filter((load) => load.name === skill.name);
    const cell = (subset) => ({
      loads: subset.length,
      threads: new Set(subset.map((load) => load.who)).size,
    });
    return {
      skill: skill.name,
      invocation: skill.invocation,
      descriptionChars: skill.descriptionChars,
      ...Object.fromEntries(
        providers.map((provider) => [provider, cell(mine.filter((load) => load.provider === provider))]),
      ),
      total: cell(mine),
    };
  });
  const skillsReport = {
    inventory: {
      available: skills.available,
      total: inventory.length,
      modelInvocable: inventory.filter((skill) => skill.invocation === "model").length,
      userInvoked: inventory.filter((skill) => skill.invocation === "user").length,
      descriptionChars: inventory.reduce((sum, skill) => sum + skill.descriptionChars, 0),
      approxTokens: Math.round(
        inventory.reduce((sum, skill) => sum + skill.descriptionChars, 0) / 4,
      ),
    },
    rows: skillRows,
    zeroUse: skillRows.filter((row) => row.total.loads === 0).map((row) => row.skill),
    singleProvider: skillRows
      .filter((row) => providers.filter((provider) => row[provider].loads > 0).length === 1)
      .map((row) => row.skill),
    outsideRepoLoads: windowed.filter((load) => !known.has(load.name)).length,
  };

  // ---------------------------------------------------------------- mix, runs
  const allRuns = t3Threads.flatMap((thread) =>
    thread.runs.map((run) => ({ ...run, role: thread.role })),
  );
  const runs = allRuns.filter((run) => inWindow(run.requestedAt));
  const rowKeys = new Set([
    ...threads.map((thread) => `${thread.role}|${thread.provider}`),
    ...runs.map((run) => `${run.role}|${run.provider}`),
  ]);
  const mixRows = [...rowKeys].sort().map((key) => {
    const [role, provider] = key.split("|");
    const mineRuns = runs.filter((run) => run.role === role && run.provider === provider);
    return {
      role,
      provider,
      threads: threads.filter((thread) => thread.role === role && thread.provider === provider).length,
      runs: mineRuns.length,
      runMinutes: round(
        mineRuns.reduce((sum, run) => sum + (run.durationMs === null ? 0 : minutes(run.durationMs)), 0),
      ),
    };
  });
  const implementThreads = threads.filter((thread) => thread.role === "implement");
  const implementClaude = implementThreads.filter((thread) => thread.provider === "claudeAgent").length;
  const implementCodex = implementThreads.filter((thread) => thread.provider === "codex").length;
  const mix = {
    rows: mixRows,
    claudeShare: {
      target,
      implementClaudeThreads: implementClaude,
      implementCodexThreads: implementCodex,
      achieved: share(implementClaude, implementClaude + implementCodex),
    },
    unclassifiedThreads: threads.filter((thread) => thread.role === "other").length,
  };

  const failed = runs.filter((run) => run.status === "failed");
  const runsReport = t3.available
    ? {
        available: true,
        byProvider: [...new Set(runs.map((run) => run.provider))].sort().map((provider) => {
          const mine = runs.filter((run) => run.provider === provider);
          const done = mine.filter((run) => run.status === "completed" && run.durationMs !== null);
          return {
            provider,
            runs: mine.length,
            completed: mine.filter((run) => run.status === "completed").length,
            failed: mine.filter((run) => run.status === "failed").length,
            duration: rounded(summarize(done.map((run) => minutes(run.durationMs)))),
          };
        }),
        failedTotal: failed.length,
        failedToUsageLimit: failed.filter((run) => run.failureClass === "usage_limit").length,
        failureClasses: [...groupCount(failed, (run) => run.failureClass)]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([name, count]) => ({ class: name, runs: count })),
        failedByProvider: [...groupCount(failed, (run) => `${run.provider}|${run.failureClass}`)]
          .sort()
          .map(([key, count]) => {
            const [provider, name] = key.split("|");
            return { provider, class: name, runs: count };
          }),
        models: [...groupCount(runs, (run) => run.model)]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([model, count]) => ({ model, runs: count })),
      }
    : unavailable(t3.reason);

  // ------------------------------------------------------- gate, reviews, PRs
  const gateRecords = [];
  for (const thread of t3Threads) {
    for (const gate of thread.gates) gateRecords.push({ ...gate, thread });
  }
  const outsideGates = outsideClaude.flatMap((session) => session.gates);
  const gatesInWindow = gateRecords.filter((gate) => inWindow(gate.at));
  const outsideInWindow = outsideGates.filter((gate) => inWindow(gate.at));
  const mentions = gatesInWindow.length + outsideInWindow.length;
  const everyGate = [...gatesInWindow.filter((record) => record.strict), ...outsideInWindow];
  const gateMinutes = everyGate.filter((gate) => gate.ms !== null).map((gate) => minutes(gate.ms));
  const passed = everyGate.filter((gate) => gate.status === "completed").length;
  const failedGates = everyGate.filter((gate) => gate.status === "failed").length;

  const prThreads = new Map();
  for (const thread of threads) {
    for (const pr of prsOf(thread)) {
      if (!prThreads.has(pr)) prThreads.set(pr, []);
      prThreads.get(pr).push(thread);
    }
  }
  const gatesByPr = new Map();
  for (const gate of gatesInWindow.filter((record) => record.strict)) {
    for (const pr of prsOf(gate.thread)) gatesByPr.set(pr, (gatesByPr.get(pr) ?? 0) + 1);
  }
  const prRows = [...prThreads].map(([pr, mine]) => ({
    pr,
    threads: mine.length,
    reviewThreads: mine.filter((thread) => thread.role === "review").length,
    gateRuns: gatesByPr.get(pr) ?? 0,
  }));
  prRows.sort((a, b) => b.threads - a.threads || a.pr - b.pr);
  const reviews = {
    available: t3.available,
    prs: prRows.length,
    threadsPerPr: rounded(summarize(prRows.map((row) => row.threads))),
    reviewThreadsPerPr: rounded(summarize(prRows.map((row) => row.reviewThreads))),
    top: prRows.slice(0, 5),
  };
  const gate = {
    available: t3.available || claude.available,
    runs: everyGate.length,
    passed,
    failed: failedGates,
    other: everyGate.length - passed - failedGates,
    failedShare: share(failedGates, everyGate.length),
    wallMinutes: round(gateMinutes.reduce((sum, value) => sum + value, 0)),
    duration: rounded(summarize(gateMinutes)),
    perPr: rounded(summarize(prRows.map((row) => row.gateRuns))),
    outsideT3Runs: outsideInWindow.length,
    mentionRuns: mentions,
    mentionFailed: [...gatesInWindow, ...outsideInWindow].filter((record) => record.status === "failed").length,
  };

  // ------------------------------------------------------------------ context
  const peaks = (provider) => threads.filter((thread) => thread.provider === provider && thread.peakTokens !== null);
  const outsidePeaks = outsideClaude.filter(
    (session) => session.peakContext !== null && inWindow(session.firstAt),
  );
  const peakProviders = providers.filter(
    (provider) => peaks(provider).length > 0 || (provider === "claudeAgent" && outsidePeaks.length > 0),
  );
  const peakTokens = peakProviders.map((provider) => {
    const t3Values = peaks(provider).map((thread) => thread.peakTokens);
    const outside = provider === "claudeAgent" ? outsidePeaks.map((session) => session.peakContext) : [];
    const summary = summarize([...t3Values, ...outside]);
    return {
      provider,
      threads: summary.n,
      median: round(summary.median, 0),
      p90: round(summary.p90, 0),
      max: summary.max,
      outsideT3Max: outside.length === 0 ? null : Math.max(...outside),
    };
  });
  const implementRuns = implementThreads.map((thread) => thread.runs.length);
  const implementTurns = implementThreads.map((thread) => thread.turns);
  const tickThreads = threads.filter((thread) => thread.role === "tick");
  const tickRuns = runs.filter((run) => run.role === "tick");
  const tickNoop = tickRuns.filter((run) => !run.launched).length;
  const tickMinutes = tickRuns.filter((run) => run.durationMs !== null).map((run) => minutes(run.durationMs));
  const context = {
    available: t3.available,
    peakTokens,
    atLeast200kTokens: threads.filter((thread) => thread.peakTokens !== null && thread.peakTokens >= 200000).length,
    atLeastHalfWindow: threads.filter(
      (thread) =>
        thread.peakTokens !== null && thread.peakWindow !== null && thread.peakTokens >= thread.peakWindow / 2,
    ).length,
    implement: {
      threads: implementThreads.length,
      runsPerThread: rounded(summarize(implementRuns)),
      turnsPerThread: rounded(summarize(implementTurns)),
    },
    tick: {
      threads: tickThreads.length,
      runs: tickRuns.length,
      noopRuns: tickNoop,
      noopShare: share(tickNoop, tickRuns.length),
      runMinutes: rounded(summarize(tickMinutes)),
      usd: null,
      usdPerRun: null,
    },
  };

  // --------------------------------------------------------------------- cost
  const costed = claudeSessions.filter((session) => session.cost !== null && inWindow(session.lastAt));
  const roleOfSession = (session) => (session.linked ? (roleByNative.get(session.id) ?? "other") : "interactive");
  const byRole = new Map();
  const byModel = new Map();
  for (const session of costed) {
    const role = roleOfSession(session);
    const entry = byRole.get(role) ?? { role, sessions: 0, usd: 0 };
    entry.sessions += 1;
    entry.usd += session.cost.usd;
    byRole.set(role, entry);
    for (const [model, usd] of Object.entries(session.cost.models)) {
      byModel.set(model, (byModel.get(model) ?? 0) + usd);
    }
  }
  const cost = claude.available
    ? {
        available: true,
        sessions: costed.length,
        totalUsd: round(costed.reduce((sum, session) => sum + session.cost.usd, 0), 4),
        byRole: [...byRole.values()]
          .sort((a, b) => b.usd - a.usd || a.role.localeCompare(b.role))
          .map((entry) => ({ ...entry, usd: round(entry.usd, 4) })),
        byModel: [...byModel]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([model, usd]) => ({ model, usd: round(usd, 4) })),
      }
    : unavailable(claude.reason);

  const tickCost = byRole.get("tick");
  if (tickCost !== undefined) {
    context.tick.usd = round(tickCost.usd, 4);
    context.tick.usdPerRun = tickRuns.length === 0 ? null : round(tickCost.usd / tickRuns.length, 4);
  }

  // ------------------------------------------------------------ codex limits
  const samples = codexSessions.flatMap((session) => session.samples).filter((sample) => inWindow(sample.at));
  const hits = samples.filter((sample) => sample.primary >= 100 || sample.secondary >= 100);
  const codexLimits = codex.available
    ? {
        available: true,
        samples: samples.length,
        atLimit: hits.length,
        daysAtLimit: new Set(hits.map((sample) => String(sample.at).slice(0, 10))).size,
        maxPercent: samples.length === 0 ? null : Math.max(...samples.flatMap((s) => [s.primary, s.secondary])),
      }
    : unavailable(codex.reason);

  // ---------------------------------------------------------------- hygiene
  const unarchived = t3Threads.filter((thread) => !thread.archived);
  const weekAgo = until - 7 * 86400000;
  const megabytes = (bytes) => round(bytes / 1048576, 1);
  const hygieneReport = {
    worktrees: hygiene.available ? { available: true, ...hygiene.worktrees } : unavailable("git"),
    branches: hygiene.available ? { available: true, ...hygiene.branches } : unavailable("git"),
    threads: t3.available
      ? {
          available: true,
          total: t3Threads.length,
          unarchived: unarchived.length,
          unarchivedSettled: unarchived.filter((thread) => thread.settled).length,
          unarchivedOlderThanWeek: unarchived.filter((thread) => Date.parse(thread.createdAt) < weekAgo).length,
        }
      : unavailable(t3.reason),
    db: t3.available
      ? { available: true, megabytes: megabytes(t3.dbBytes), walMegabytes: megabytes(t3.walBytes) }
      : unavailable(t3.reason),
  };

  const tasks = t3.available ? t3.tasks : [];
  const schedule = t3.available
    ? {
        available: true,
        tasks: tasks.length,
        enabled: tasks.filter((task) => task.enabled).length,
        rows: tasks.map((task) => ({
          kind: safeToken(task.kind),
          everyHours: round(task.everyHours),
          threadMode: task.threadMode,
          enabled: task.enabled,
          runCount: task.runCount,
          lastStatus: task.lastStatus,
        })),
      }
    : unavailable(t3.reason);

  return {
    window: {
      all,
      days: all ? null : days,
      since: all ? null : new Date(since).toISOString(),
      until: new Date(until).toISOString(),
    },
    coverage,
    skills: skillsReport,
    mix,
    runs: runsReport,
    reviews,
    gate,
    context,
    cost,
    codexLimits,
    hygiene: hygieneReport,
    schedule,
  };
}

// Provider-thread ids the T3 database knows, used to tell linked transcripts from outside ones.
export function linkedIdsFrom(t3) {
  return new Set(t3.available ? t3.threads.flatMap((thread) => thread.nativeIds) : []);
}
