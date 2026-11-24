// Regression suite for the process-review collector. It builds a synthetic T3 database,
// Claude Code and Codex transcripts and a scratch git repo, runs collect.mjs against them,
// and checks the measures and the privacy rule: aggregate counts only, never source text.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publishReport } from "./render.mjs";
import {
  assertPublishable,
  classifyRole,
  isGateCommand,
  percentile,
  safeToken,
  skillsFromCommand,
  summarize,
} from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const collector = join(here, "collect.mjs");

// ---------------------------------------------------------------- pure helpers

assert.equal(percentile([], 0.9), null);
assert.equal(percentile([5], 0.9), 5);
assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
assert.equal(percentile([10, 1, 7], 0.5), 7);
assert.deepEqual(summarize([]), {
  n: 0,
  total: 0,
  mean: null,
  median: null,
  p90: null,
  max: null,
});
assert.deepEqual(summarize([2, 1]), {
  n: 2,
  total: 3,
  mean: 1.5,
  median: 1.5,
  p90: 2,
  max: 2,
});

for (const yes of [
  "pnpm check",
  "CI=true pnpm check",
  ". scripts/pinned-node.sh && CI=true pnpm check",
  "cd /x && pnpm check 2>&1 | tail -20",
  "/usr/bin/bash -lc 'cd /x && . scripts/pinned-node.sh && CI=true pnpm check'",
  'bash -lc "pnpm run check"',
  "pnpm check; echo done",
  "cat > notes.md <<'EOF'\nnotes\nEOF\nCI=true pnpm check",
]) {
  assert.equal(isGateCommand(yes), true, yes);
}
for (const no of [
  'echo "run pnpm check later"; cat notes.txt',
  "gh pr create --body 'ran pnpm check'",
  "git commit -m 'pnpm check passes'",
  "grep -rn 'pnpm check' docs",
  "pnpm check:something-else",
  "cat <<'EOF'\npnpm check\nEOF",
]) {
  assert.equal(isGateCommand(no), false, no);
}

assert.deepEqual(skillsFromCommand("sed -n 1,80p .agents/skills/beta/SKILL.md"), [
  "beta",
]);
assert.deepEqual(
  skillsFromCommand("cat .claude/skills/alpha/SKILL.md .agents/skills/tdd/SKILL.md"),
  ["alpha", "tdd"],
);
assert.deepEqual(
  skillsFromCommand("git show origin/main:.agents/skills/tick/SKILL.md"),
  ["tick"],
);
assert.deepEqual(skillsFromCommand("git add .agents/skills/beta/SKILL.md"), []);
assert.deepEqual(skillsFromCommand("git diff -- .agents/skills/beta/SKILL.md"), []);
assert.deepEqual(skillsFromCommand("sed -i s/a/b/ .agents/skills/beta/SKILL.md"), []);
assert.deepEqual(skillsFromCommand("ls .agents/skills/beta"), []);

const role = (text, createdBy = "agent", skills = []) =>
  classifyRole({ firstMessage: text, createdBy, skills });
assert.equal(role("Work GitHub issue #12 on `o/r`."), "implement");
assert.equal(role("Act as the implementation sub-agent for this task."), "implement");
assert.equal(role("Act as the review sub-agent for this task."), "review");
assert.equal(role("Run a `docs` planner for planning issue #5"), "plan");
assert.equal(role("Act as the research sub-agent for this task."), "research");
assert.equal(role("Load the `tick` skill (.agents/skills/tick/SKILL.md)"), "tick");
assert.equal(role("Run nightly ticket triage for the repo."), "triage");
assert.equal(role("Read .agents/skills/triage/SKILL.md and run it"), "triage");
assert.equal(role("Run the merge audit from the land skill for PR #3"), "audit");
assert.equal(role("Run the `read-main` skill's script"), "read-only");
assert.equal(role("anything", "user"), "interactive");
assert.equal(role("something unusual"), "other");
assert.equal(role("", "agent", ["tick"]), "tick");

assert.equal(safeToken("usage_limit"), "usage_limit");
assert.equal(safeToken("model-gamma"), "model-gamma");
assert.equal(safeToken("model-beta"), "model-beta");
assert.equal(safeToken("two words"), "other");
assert.equal(safeToken("/home/x/y"), "other");
assert.equal(safeToken("x".repeat(80)), "other");
assert.equal(safeToken(undefined), "other");
assert.equal(safeToken(42), "other");

assert.doesNotThrow(() => assertPublishable("| a | 12 | 3.5 |\n| usage_limit | 4 |"));
for (const bad of [
  "see /home/someone/project",
  "in /Users/someone/x",
  "at /tmp/x/y",
  "~/notes",
  "C:\\Users\\x",
  "https://example.test/x",
  "mail me@example.test",
  "3f2b8c1e-aaaa-bbbb-cccc-0123456789ab",
  "deadbeefdeadbeefdeadbeefdeadbeef",
  "state.sqlite",
  "rollout.jsonl",
  "naïve",
]) {
  assert.throws(() => assertPublishable(bad), /publish/i, bad);
}

// ---------------------------------------------------------------- fixture

const SECRET = "SECRET";
const root = realpathSync(mkdtempSync(join(tmpdir(), "process-review-")));
const home = join(root, "home", "fixture-user");
const repo = join(root, "work", "card-game");
const dbPath = join(home, ".t3", "userdata", "statev2.sqlite");
const claudeDir = join(home, ".claude", "projects");
const codexDir = join(home, ".codex", "sessions");
const NOW = "2026-11-23T12:00:00Z";

function git(...args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: {
      ...env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
}

function skill(name, { user = false, description }) {
  const dir = join(repo, ".agents", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      user ? 'description: "One line."' : `description: >-\n  ${description}\n  second line.`,
      ...(user ? ["disable-model-invocation: true"] : []),
      "---",
      "",
      "# body",
      "",
    ].join("\n"),
  );
}

function buildRepo() {
  mkdirSync(repo, { recursive: true });
  git("init", "-q", "-b", "main");
  skill("alpha", { description: "A".repeat(40) });
  skill("beta", { user: true });
  skill("gamma", { description: "G".repeat(10) });
  skill("tdd", { description: "T".repeat(20) });
  skill("plan", { description: "P".repeat(20) });
  skill("tick", { description: "K".repeat(20) });
  mkdirSync(join(repo, ".agents", "skills", "tick"), { recursive: true });
  writeFileSync(
    join(repo, ".agents", "skills", "tick", "config.json"),
    JSON.stringify({ implement: { claudeShare: 0.5 } }),
  );
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  // One merged leftover worktree and branch, one unmerged dirty worktree.
  git("branch", "ticket/merged-one");
  const merged = join(root, "work", "wt-merged");
  git("worktree", "add", "-q", merged, "ticket/merged-one");
  git("checkout", "-q", "-b", "ticket/open-one");
  writeFileSync(join(repo, "extra.txt"), "x");
  git("add", "-A");
  git("commit", "-q", "-m", "open work");
  git("checkout", "-q", "main");
  const open = join(root, "work", "wt-open");
  git("worktree", "add", "-q", open, "ticket/open-one");
  writeFileSync(join(open, "dirty.txt"), "dirty");
  git("branch", `ticket/${SECRET}-branch`);
}

const ddl = `
CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, title TEXT NOT NULL, workspace_root TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, default_provider TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, deleted_at TEXT, payload_json TEXT NOT NULL);
CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, ordinal INTEGER NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, requested_at TEXT NOT NULL, completed_at TEXT, payload_json TEXT NOT NULL);
CREATE TABLE orchestration_v2_projection_turn_items (turn_item_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, run_id TEXT, ordinal INTEGER NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE orchestration_v2_projection_provider_threads (provider_thread_id TEXT PRIMARY KEY, thread_id TEXT, provider TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE orchestration_v2_projection_provider_turns (provider_turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, provider_thread_id TEXT NOT NULL, ordinal INTEGER NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE scheduled_tasks (task_id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL, enabled INTEGER NOT NULL, schedule_json TEXT NOT NULL, project_id TEXT NOT NULL, thread_mode TEXT, run_count INTEGER NOT NULL, last_run_status TEXT);
`;

function buildDatabase() {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(ddl);
  const insert = (table, row) =>
    db
      .prepare(
        `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row)
          .map(() => "?")
          .join(",")})`,
      )
      .run(...Object.values(row));
  insert("projection_projects", {
    project_id: "p1",
    title: "card-game",
    workspace_root: `${repo}`,
    deleted_at: null,
  });
  insert("projection_projects", {
    project_id: "p2",
    title: "other-project",
    workspace_root: "/elsewhere",
    deleted_at: null,
  });
  let seq = 0;
  const thread = (id, o) => {
    insert("orchestration_v2_projection_threads", {
      thread_id: id,
      project_id: o.project ?? "p1",
      title: `${SECRET} title ${id}`,
      default_provider: o.provider,
      created_at: o.created,
      updated_at: o.created,
      archived_at: o.archived ?? null,
      deleted_at: null,
      payload_json: JSON.stringify({
        createdBy: o.createdBy ?? "agent",
        title: `${SECRET} title ${id}`,
        pullRequests: (o.prs ?? []).map(([number, repository]) => ({
          number,
          repository: repository ?? "owner/card-game",
          url: `https://github.com/owner/card-game/pull/${number}`,
        })),
        settledOverride: o.settled ?? null,
        lineage: { parentThreadId: o.parent ?? null },
      }),
    });
    item(id, null, "user_message", o.created, {
      createdBy: o.createdBy ?? "agent",
      text: `${o.first} ${SECRET}-prompt-${id}`,
    });
    if (o.native) {
      insert("orchestration_v2_projection_provider_threads", {
        provider_thread_id: `pt-${id}`,
        thread_id: id,
        provider: o.provider,
        payload_json: JSON.stringify({ nativeThreadRef: { nativeId: o.native } }),
      });
    }
    (o.turns ?? []).forEach(([used, max], i) =>
      insert("orchestration_v2_projection_provider_turns", {
        provider_turn_id: `turn-${id}-${i}`,
        thread_id: id,
        provider_thread_id: `pt-${id}`,
        ordinal: i,
        status: "completed",
        payload_json: JSON.stringify({
          tokenUsage: { usedTokens: used, maxTokens: max },
        }),
      }),
    );
  };
  const run = (id, threadId, provider, status, requested, completed, o = {}) => {
    insert("orchestration_v2_projection_runs", {
      run_id: id,
      thread_id: threadId,
      ordinal: ++seq,
      provider,
      status,
      requested_at: requested,
      completed_at: completed,
      payload_json: JSON.stringify({
        modelSelection: { model: o.model ?? "model-alpha" },
        startedAt: requested,
        completedAt: completed,
      }),
    });
    if (o.failureClass !== undefined) {
      item(threadId, id, "error", completed, {
        status: "failed",
        title: `${SECRET} error title`,
        failure: {
          class: o.failureClass,
          message: `${SECRET}-error-message`,
          code: "usageLimitExceeded",
        },
      });
    }
  };
  const item = (threadId, runId, type, at, payload) =>
    insert("orchestration_v2_projection_turn_items", {
      turn_item_id: `item-${++seq}`,
      thread_id: threadId,
      run_id: runId,
      ordinal: seq,
      type,
      status: payload.status ?? "completed",
      updated_at: at,
      payload_json: JSON.stringify({ type, startedAt: at, ...payload }),
    });
  const tool = (threadId, driver, name, input, at, runId = null) =>
    item(threadId, runId, "dynamic_tool", at, {
      toolName: name,
      input,
      nativeItemRef: { driver },
    });
  const command = (threadId, driver, input, start, end, status = "completed") =>
    insert("orchestration_v2_projection_turn_items", {
      turn_item_id: `item-${++seq}`,
      thread_id: threadId,
      run_id: null,
      ordinal: seq,
      type: "command_execution",
      status,
      updated_at: end,
      payload_json: JSON.stringify({
        type: "command_execution",
        startedAt: start,
        completedAt: end,
        status,
        input,
        output: `${SECRET}-command-output /home/fixture-user/private`,
        nativeItemRef: { driver },
      }),
    });

  // A: Claude implement, in window, PR 10 (and a PR in another repository).
  thread("tA", {
    provider: "claudeAgent",
    created: "2026-11-20T10:00:00Z",
    first: "Work GitHub issue #1 on `owner/card-game`.",
    prs: [
      [10, "owner/card-game"],
      [99, "owner/other-repo"],
    ],
    native: "sess-A",
    turns: [
      [100000, 200000],
      [150000, 200000],
    ],
  });
  run("rA1", "tA", "claudeAgent", "completed", "2026-11-20T10:00:00Z", "2026-11-20T10:10:00Z");
  run("rA2", "tA", "claudeAgent", "completed", "2026-11-20T10:30:00Z", "2026-11-20T10:50:00Z");
  tool("tA", "claudeAgent", "Skill", { skill: "tdd" }, "2026-11-20T10:01:00Z");
  tool("tA", "claudeAgent", "Skill", { skill: `${SECRET}-skill` }, "2026-11-20T10:02:00Z");
  tool(
    "tA",
    "claudeAgent",
    "Read",
    { file_path: "/home/fixture-user/repo/.agents/skills/alpha/SKILL.md" },
    "2026-11-20T10:03:00Z",
  );
  command("tA", "claudeAgent", ". scripts/pinned-node.sh && CI=true pnpm check", "2026-11-20T10:05:00Z", "2026-11-20T10:10:00Z");
  command("tA", "claudeAgent", "pnpm check", "2026-11-20T10:20:00Z", "2026-11-20T10:23:00Z", "failed");
  command("tA", "claudeAgent", 'echo "run pnpm check later"; cat notes.txt', "2026-11-20T10:24:00Z", "2026-11-20T10:24:01Z");
  command("tA", "claudeAgent", "git add .agents/skills/beta/SKILL.md", "2026-11-20T10:25:00Z", "2026-11-20T10:25:01Z");

  // B: Codex review, in window, PR 10. Two failed runs and one completed.
  thread("tB", {
    provider: "codex",
    created: "2026-11-21T09:00:00Z",
    first: "Act as the review sub-agent for this task.",
    prs: [[10]],
    native: "sess-B",
    turns: [[50000, 258000]],
  });
  run("rB1", "tB", "codex", "failed", "2026-11-21T09:00:00Z", "2026-11-21T09:01:00Z", {
    model: "model-beta",
    failureClass: "usage_limit",
  });
  run("rB2", "tB", "codex", "completed", "2026-11-21T09:10:00Z", "2026-11-21T09:40:00Z", {
    model: "model-beta",
  });
  run("rB3", "tB", "codex", "failed", "2026-11-21T09:50:00Z", "2026-11-21T09:51:00Z", {
    model: `${SECRET} model with spaces`,
    failureClass: `${SECRET} class with spaces`,
  });
  command("tB", "codex", "sed -n 1,80p .agents/skills/beta/SKILL.md", "2026-11-21T09:11:00Z", "2026-11-21T09:11:01Z");
  command("tB", "codex", "/usr/bin/bash -lc 'cd /x && CI=true pnpm check'", "2026-11-21T09:15:00Z", "2026-11-21T09:25:00Z");

  // C: Codex implement, before the window, PR 11.
  thread("tC", {
    provider: "codex",
    created: "2026-11-10T08:00:00Z",
    first: "Work GitHub issue #2 on `owner/card-game`.",
    prs: [[11]],
    native: "sess-C",
    turns: [[250000, 258000]],
  });
  run("rC1", "tC", "codex", "completed", "2026-11-10T08:00:00Z", "2026-11-10T08:30:00Z", {
    model: "model-beta",
  });
  command("tC", "codex", "cat .agents/skills/gamma/SKILL.md", "2026-11-10T08:01:00Z", "2026-11-10T08:01:01Z");
  command("tC", "codex", "pnpm check", "2026-11-10T08:10:00Z", "2026-11-10T08:12:00Z", "failed");

  // D: Claude planner. E: tick with no launch. F: tick that launches.
  thread("tD", {
    provider: "claudeAgent",
    created: "2026-11-22T08:00:00Z",
    first: "Run a `docs` planner for planning issue #5 on `owner/card-game`.",
  });
  run("rD1", "tD", "claudeAgent", "completed", "2026-11-22T08:00:00Z", "2026-11-22T08:05:00Z");
  tool("tD", "claudeAgent", "Skill", { skill: "plan" }, "2026-11-22T08:01:00Z");
  thread("tE", {
    provider: "claudeAgent",
    created: "2026-11-22T06:00:00Z",
    first: "Load the `tick` skill (.agents/skills/tick/SKILL.md) and run one pass.",
  });
  run("rE1", "tE", "claudeAgent", "completed", "2026-11-22T06:00:00Z", "2026-11-22T06:02:00Z");
  tool("tE", "claudeAgent", "Skill", { skill: "tick" }, "2026-11-22T06:00:30Z");
  thread("tF", {
    provider: "claudeAgent",
    created: "2026-11-23T06:00:00Z",
    first: "Load the `tick` skill (.agents/skills/tick/SKILL.md) and run one pass.",
  });
  run("rF1", "tF", "claudeAgent", "completed", "2026-11-23T06:00:00Z", "2026-11-23T06:03:00Z");
  tool("tF", "claudeAgent", "Skill", { skill: "tick" }, "2026-11-23T06:00:30Z");
  tool("tF", "claudeAgent", "mcp__t3-code__t3_thread_launch", { prompt: `${SECRET}-launch` }, "2026-11-23T06:01:00Z", "rF1");

  // G: archived interactive OpenCode. H: Claude review on PR 10. I: Claude implement, PR 12.
  thread("tG", {
    provider: "opencode",
    created: "2026-11-22T10:00:00Z",
    createdBy: "user",
    first: "just chatting",
    archived: "2026-11-22T11:00:00Z",
  });
  run("rG1", "tG", "opencode", "completed", "2026-11-22T10:00:00Z", "2026-11-22T10:10:00Z", {
    model: "big-pickle",
  });
  thread("tH", {
    provider: "claudeAgent",
    created: "2026-11-17T10:00:00Z",
    first: "Act as the review sub-agent for this task.",
    parent: "tA",
  });
  run("rH1", "tH", "claudeAgent", "completed", "2026-11-17T10:00:00Z", "2026-11-17T10:20:00Z");
  thread("tI", {
    provider: "claudeAgent",
    created: "2026-11-22T12:00:00Z",
    first: "Work GitHub issue #3 on `owner/card-game`.",
    prs: [[12]],
  });
  run("rI1", "tI", "claudeAgent", "completed", "2026-11-22T12:00:00Z", "2026-11-22T12:30:00Z");

  // J: another project, must not be counted.
  thread("tJ", {
    project: "p2",
    provider: "claudeAgent",
    created: "2026-11-22T12:00:00Z",
    first: "Work GitHub issue #4 on `owner/other`.",
    prs: [[500]],
  });
  run("rJ1", "tJ", "claudeAgent", "failed", "2026-11-22T12:00:00Z", "2026-11-22T12:01:00Z", {
    failureClass: "other_project_class",
  });

  insert("scheduled_tasks", {
    task_id: `${SECRET}-task-id`,
    title: `${SECRET} task title`,
    prompt: `${SECRET} task prompt`,
    enabled: 1,
    schedule_json: JSON.stringify({ type: "interval", everyMs: 3600000 }),
    project_id: "p1",
    thread_mode: "fresh_session",
    run_count: 8,
    last_run_status: "succeeded",
  });
  insert("scheduled_tasks", {
    task_id: "task-two",
    title: "second",
    prompt: "second",
    enabled: 0,
    schedule_json: JSON.stringify({ type: "fixed_time", timeOfDay: "02:00" }),
    project_id: "p1",
    thread_mode: "fresh_session",
    run_count: 1,
    last_run_status: "succeeded",
  });
  const more = (id, enabled, schedule, prompt) =>
    insert("scheduled_tasks", {
      task_id: id,
      title: `${SECRET} ${id}`,
      prompt,
      enabled,
      schedule_json: JSON.stringify(schedule),
      project_id: "p1",
      thread_mode: "fresh_session",
      run_count: 2,
      last_run_status: "succeeded",
    });
  more("task-tick", 0, { type: "interval", everyMs: 3600000 }, `Run the tick for ${SECRET}.`);
  more(
    "task-triage",
    1,
    { type: "fixed_time", weekdays: [0, 1, 2, 3, 4, 5, 6], timeOfDay: "02:00" },
    `Run nightly ticket triage for ${SECRET}. Load read-main.`,
  );
  more(
    "task-review",
    1,
    { type: "fixed_time", weekdays: [1], timeOfDay: "06:00" },
    `Run the weekly process review for ${SECRET}.`,
  );
  more(
    "task-hostile",
    0,
    {
      type: "fixed_time",
      weekdays: ["Private prompt: acquire Contoso", 9, 3, 3],
      timeOfDay: "Private prompt: acquire Contoso before Friday",
    },
    "Private prompt: acquire Contoso before Friday.",
  );
  db.close();
}

function jsonl(path, lines) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

function buildTranscripts() {
  const session = (dir, id, extra) =>
    jsonl(join(claudeDir, dir, `${id}.jsonl`), extra);
  const assistant = (at, content, usage) => ({
    type: "assistant",
    timestamp: at,
    message: { role: "assistant", content, usage },
  });
  const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
  const cost = (usd, model = "model-alpha") => ({
    type: "cost-state",
    totalCostUSD: usd,
    modelUsage: { [model]: { costUSD: usd } },
  });
  // Linked to thread A: only cost is taken from it, so its Skill call must not double count.
  session("-work-card-game-wt", "sess-A", [
    assistant("2026-11-20T10:01:00Z", [toolUse("a1", "Skill", { skill: "tdd" })], {
      input_tokens: 10,
      cache_read_input_tokens: 90000,
      cache_creation_input_tokens: 0,
      output_tokens: 5,
    }),
    cost(2.5),
  ]);
  // Outside T3: one Skill load, one passing gate run, a context peak, and a cost.
  session("-work-card-game", "sess-outside", [
    assistant(
      "2026-11-22T14:00:00Z",
      [toolUse("o1", "Skill", { skill: "alpha" }), toolUse("o2", "Bash", { command: "CI=true pnpm check" })],
      {
        input_tokens: 100,
        cache_read_input_tokens: 70000,
        cache_creation_input_tokens: 5000,
        output_tokens: 50,
      },
    ),
    {
      type: "user",
      timestamp: "2026-11-22T14:04:00Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "o2", is_error: false, content: `${SECRET}-output` }],
      },
    },
    cost(1),
  ]);
  // A different project's transcripts are never read.
  session("-work-other-project", "sess-foreign", [
    assistant("2026-11-22T14:00:00Z", [toolUse("f1", "Skill", { skill: "alpha" })], {
      input_tokens: 1,
      cache_read_input_tokens: 1,
      cache_creation_input_tokens: 1,
      output_tokens: 1,
    }),
    cost(100),
  ]);

  const meta = (id, cwd) => ({
    type: "session_meta",
    timestamp: "2026-11-21T09:00:00Z",
    payload: { id, cwd },
  });
  const sample = (at, primary, secondary) => ({
    type: "event_msg",
    timestamp: at,
    payload: {
      type: "token_count",
      info: { last_token_usage: { total_tokens: 1 }, model_context_window: 258000 },
      rate_limits: {
        primary: { used_percent: primary },
        secondary: { used_percent: secondary },
      },
    },
  });
  jsonl(join(codexDir, "2026", "11", "21", "rollout-sess-B.jsonl"), [
    meta("sess-B", "/home/fixture-user/wt/card-game/b"),
    sample("2026-11-21T09:12:00Z", 100, 40),
    sample("2026-11-21T09:13:00Z", 60, 100),
    sample("2026-11-21T09:14:00Z", 20, 40),
  ]);
  jsonl(join(codexDir, "2026", "11", "22", "rollout-outside.jsonl"), [
    meta("sess-codex-outside", "/home/fixture-user/wt/card-game/x"),
    {
      type: "response_item",
      timestamp: "2026-11-22T15:00:00Z",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        input: "cat .agents/skills/beta/SKILL.md",
      },
    },
    {
      type: "response_item",
      timestamp: "2026-11-22T15:00:01Z",
      payload: {
        type: "function_call_output",
        output: "cat .agents/skills/gamma/SKILL.md in a developer message",
      },
    },
    sample("2026-11-22T15:01:00Z", 30, 30),
  ]);
  jsonl(join(codexDir, "2026", "11", "22", "rollout-foreign.jsonl"), [
    meta("sess-codex-foreign", "/home/fixture-user/wt/not-this-project/x"),
    sample("2026-11-22T15:01:00Z", 100, 100),
  ]);
}

buildRepo();
buildDatabase();
buildTranscripts();

function collect(args, env = {}) {
  const result = spawnSync(
    process.execPath,
    [
      collector,
      "--repo",
      repo,
      "--t3-db",
      dbPath,
      "--projects-dir",
      claudeDir,
      "--sessions-dir",
      codexDir,
      "--now",
      NOW,
      ...args,
    ],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
  return result;
}

try {
  // ------------------------------------------------------------ weekly window
  const weekly = collect(["--format", "json"]);
  assert.equal(weekly.status, 0, weekly.stderr);
  const week = JSON.parse(weekly.stdout);

  assert.equal(week.window.days, 7);
  assert.equal(week.window.since, "2026-11-16T12:00:00.000Z");

  // Coverage: counts per source, with outside-T3 sessions separated.
  assert.equal(week.coverage.t3.available, true);
  assert.equal(week.coverage.t3.threads, 9);
  assert.equal(week.coverage.claude.transcripts, 2);
  assert.equal(week.coverage.claude.linkedToT3, 1);
  assert.equal(week.coverage.claude.outsideT3, 1);
  assert.equal(week.coverage.codex.sessions, 2);
  assert.equal(week.coverage.codex.linkedToT3, 1);
  assert.equal(week.coverage.codex.outsideT3, 1);
  assert.ok(week.coverage.gaps.length > 0);

  // Skills: inventory and loads by provider, outside-T3 sessions counted once.
  assert.equal(week.skills.inventory.total, 6);
  assert.equal(week.skills.inventory.modelInvocable, 5);
  assert.equal(week.skills.inventory.userInvoked, 1);
  // description text plus its folded continuation, for the five model-invocable skills.
  assert.equal(week.skills.inventory.descriptionChars, 40 + 10 + 20 + 20 + 20 + 5 * " second line.".length);
  const row = (name) => week.skills.rows.find((r) => r.skill === name);
  assert.deepEqual(row("tdd").claudeAgent, { loads: 1, threads: 1 });
  assert.deepEqual(row("alpha").claudeAgent, { loads: 2, threads: 2 });
  assert.deepEqual(row("beta").codex, { loads: 2, threads: 2 });
  assert.deepEqual(row("plan").claudeAgent, { loads: 1, threads: 1 });
  assert.deepEqual(row("tick").claudeAgent, { loads: 2, threads: 2 });
  assert.equal(row("gamma").total.loads, 0);
  assert.equal(row("beta").invocation, "user");
  assert.equal(row("alpha").invocation, "model");
  assert.deepEqual(week.skills.zeroUse, ["gamma"]);
  assert.equal(week.skills.outsideRepoLoads, 1);
  assert.ok(week.skills.singleProvider.includes("tdd"));
  assert.ok(week.skills.singleProvider.includes("beta"));

  // Mix by role and provider.
  const mix = (r, p) => week.mix.rows.find((x) => x.role === r && x.provider === p);
  assert.equal(mix("implement", "claudeAgent").threads, 2);
  assert.equal(mix("review", "codex").threads, 1);
  assert.equal(mix("review", "claudeAgent").threads, 1);
  assert.equal(mix("plan", "claudeAgent").runs, 1);
  assert.equal(mix("tick", "claudeAgent").threads, 2);
  assert.equal(mix("interactive", "opencode").threads, 1);
  assert.equal(week.mix.claudeShare.implementClaudeThreads, 2);
  assert.equal(week.mix.claudeShare.implementCodexThreads, 0);
  assert.equal(week.mix.claudeShare.achieved, 1);
  assert.equal(week.mix.claudeShare.target, 0.5);

  // Runs: durations and failure classes; the other project never appears.
  const runs = (p) => week.runs.byProvider.find((x) => x.provider === p);
  assert.equal(runs("claudeAgent").runs, 7);
  assert.equal(runs("claudeAgent").failed, 0);
  assert.equal(runs("codex").runs, 3);
  assert.equal(runs("codex").failed, 2);
  assert.equal(runs("opencode").runs, 1);
  assert.equal(runs("claudeAgent").duration.median, 10);
  assert.equal(runs("claudeAgent").duration.max, 30);
  assert.equal(week.runs.failureClasses.find((x) => x.class === "usage_limit").runs, 1);
  assert.equal(week.runs.failureClasses.find((x) => x.class === "other").runs, 1);
  assert.equal(week.runs.failureClasses.some((x) => x.class === "other_project_class"), false);
  assert.equal(week.runs.failedTotal, 2);
  assert.equal(week.runs.failedToUsageLimit, 1);
  assert.deepEqual(week.runs.models.map((m) => m.model).sort(), [
    "big-pickle",
    "model-alpha",
    "model-beta",
    "other",
  ]);

  // Reviews: threads per PR in the repo, other-repository PRs ignored.
  assert.equal(week.reviews.prs, 2);
  assert.equal(week.reviews.threadsPerPr.max, 3);
  assert.equal(week.reviews.threadsPerPr.mean, 2);
  assert.equal(week.reviews.reviewThreadsPerPr.max, 2);
  assert.deepEqual(week.reviews.top, [
    { pr: 10, threads: 3, reviewThreads: 2, gateRuns: 3 },
    { pr: 12, threads: 1, reviewThreads: 0, gateRuns: 0 },
  ]);

  // Gate cost: T3 commands plus the outside-T3 Claude session.
  assert.equal(week.gate.runs, 4);
  assert.equal(week.gate.passed, 3);
  assert.equal(week.gate.failed, 1);
  assert.equal(week.gate.failedShare, 0.25);
  assert.equal(week.gate.wallMinutes, 5 + 3 + 10 + 4);
  assert.equal(week.gate.mentionRuns, 5);
  assert.equal(week.gate.mentionFailed, 1);
  assert.equal(week.gate.perPr.max, 3);
  assert.equal(week.gate.perPr.mean, 1.5);

  // Context and turns.
  const peak = (p) => week.context.peakTokens.find((x) => x.provider === p);
  assert.equal(peak("claudeAgent").max, 150000);
  assert.equal(peak("claudeAgent").threads, 2);
  assert.equal(peak("claudeAgent").outsideT3Max, 75100);
  assert.equal(peak("codex").max, 50000);
  assert.equal(week.context.peakTokens.some((x) => x.provider === "opencode"), false);
  assert.equal(week.context.atLeastHalfWindow, 1);
  assert.equal(week.context.implement.runsPerThread.max, 2);
  assert.equal(week.context.implement.runsPerThread.median, 1.5);
  assert.equal(week.context.tick.threads, 2);
  assert.equal(week.context.tick.runs, 2);
  assert.equal(week.context.tick.noopRuns, 1);
  assert.equal(week.context.tick.noopShare, 0.5);
  assert.equal(week.context.atLeast200kTokens, 0);

  // Claude cost: linked and outside sessions, grouped by role.
  assert.equal(week.cost.available, true);
  assert.equal(week.cost.sessions, 2);
  assert.equal(week.cost.totalUsd, 3.5);
  assert.equal(week.cost.byRole.find((x) => x.role === "implement").usd, 2.5);
  assert.equal(week.cost.byRole.find((x) => x.role === "interactive").usd, 1);

  // Codex limit samples from the Codex transcripts.
  assert.equal(week.codexLimits.samples, 4);
  assert.equal(week.codexLimits.atLimit, 2);
  assert.equal(week.codexLimits.daysAtLimit, 1);
  assert.equal(week.codexLimits.maxPercent, 100);

  // Hygiene.
  assert.equal(week.hygiene.worktrees.total, 2);
  assert.equal(week.hygiene.worktrees.merged, 1);
  assert.equal(week.hygiene.worktrees.dirty, 1);
  // The default branch itself is not a leftover.
  assert.equal(week.hygiene.branches.total, 3);
  assert.equal(week.hygiene.branches.merged, 2);
  assert.deepEqual(week.hygiene.branches.byPrefix, { ticket: 3 });
  assert.equal(week.hygiene.threads.total, 9);
  assert.equal(week.hygiene.threads.unarchived, 8);
  assert.ok(week.hygiene.db.megabytes >= 0);
  assert.equal(week.schedule.available, true);
  assert.equal(week.schedule.tasks, 6);
  assert.equal(week.schedule.enabled, 3);
  const taskRow = (purpose) => week.schedule.rows.find((row) => row.purpose === purpose);
  assert.deepEqual(
    week.schedule.rows.map((row) => row.purpose).sort(),
    ["other", "other", "other", "process-review", "tick", "triage"],
  );
  // The same fixed_time kind tells triage and process review apart by purpose and cadence.
  assert.deepEqual(taskRow("triage").weekdays, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(taskRow("triage").timeOfDay, "02:00");
  assert.deepEqual(taskRow("process-review").weekdays, [1]);
  assert.equal(taskRow("process-review").timeOfDay, "06:00");
  assert.equal(taskRow("process-review").enabled, true);
  assert.equal(taskRow("tick").enabled, false);
  // A schedule that carries prose or out-of-range days yields only the safe parts.
  const hostile = week.schedule.rows.find((row) => row.timeOfDay === null && row.kind === "fixed_time");
  assert.deepEqual(hostile.weekdays, [3]);

  // ------------------------------------------------------------ all time
  const all = JSON.parse(collect(["--format", "json", "--all"]).stdout);
  assert.equal(all.window.all, true);
  assert.equal(all.window.since, null);
  assert.equal(all.gate.runs, 5);
  assert.equal(all.gate.failed, 2);
  assert.equal(all.runs.byProvider.find((x) => x.provider === "codex").runs, 4);
  assert.equal(all.mix.claudeShare.implementCodexThreads, 1);
  assert.equal(all.mix.claudeShare.achieved, 2 / 3);
  assert.equal(all.reviews.prs, 3);
  assert.equal(all.skills.zeroUse.length, 0);
  assert.equal(all.context.peakTokens.find((x) => x.provider === "codex").max, 250000);
  assert.equal(all.context.atLeastHalfWindow, 2);

  // ------------------------------------------------------------ markdown + privacy
  const markdown = collect([]);
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /^## Process review data/m);
  assert.match(markdown.stdout, /\| claudeAgent \|/);
  assert.match(markdown.stdout, /usage_limit/);
  for (const text of [markdown.stdout, weekly.stdout, collect(["--all"]).stdout]) {
    assert.doesNotThrow(() => assertPublishable(text));
    for (const leak of [
      SECRET,
      "fixture-user",
      root,
      "private",
      "owner/",
      "sess-",
      "statev2",
      "other-project",
      "https://",
      "Contoso",
      "task-triage",
    ]) {
      assert.equal(text.includes(leak), false, `output leaks ${leak}`);
    }
  }
  assert.equal(markdown.stderr.includes(SECRET), false);

  // The guard bites at run time: a value that reaches the output fails the render, and the
  // error names the rule, never the value.
  for (const format of ["json", "markdown"]) {
    assert.throws(
      () => publishReport({ section: { label: "/home/someone/secret" } }, format),
      (error) => /publish/i.test(error.message) && !error.message.includes("someone"),
    );
    assert.throws(
      () => publishReport({ section: { label: "line one\nline two" } }, format),
      /publish/i,
    );
    assert.throws(
      () => publishReport({ section: { label: "x".repeat(120) } }, format),
      /publish/i,
    );
  }
  assert.doesNotThrow(() =>
    publishReport({ section: { label: "usage_limit", n: 3 } }, "json"),
  );

  // ------------------------------------------------------------ degraded sources
  const noDb = spawnSync(
    process.execPath,
    [
      collector,
      "--repo",
      repo,
      "--t3-db",
      join(root, "missing.sqlite"),
      "--projects-dir",
      join(root, "missing-claude"),
      "--sessions-dir",
      join(root, "missing-codex"),
      "--now",
      NOW,
      "--format",
      "json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(noDb.status, 0, noDb.stderr);
  const degraded = JSON.parse(noDb.stdout);
  assert.equal(degraded.coverage.t3.available, false);
  assert.equal(degraded.coverage.claude.available, false);
  assert.equal(degraded.coverage.codex.available, false);
  assert.equal(degraded.runs.available, false);
  assert.equal(degraded.cost.available, false);
  // Sections that cannot be measured say so; a zero would read as a measurement.
  for (const part of ["mix", "reviews", "gate", "context", "schedule", "runs", "cost"]) {
    assert.equal(degraded[part].available, false, `${part} should be unavailable`);
  }
  const degradedText = spawnSync(
    process.execPath,
    [
      collector,
      "--repo",
      repo,
      "--t3-db",
      join(root, "missing.sqlite"),
      "--projects-dir",
      join(root, "missing-claude"),
      "--sessions-dir",
      join(root, "missing-codex"),
      "--now",
      NOW,
    ],
    { encoding: "utf8" },
  ).stdout;
  for (const title of [
    "Mix by role and provider",
    "Review rounds per PR",
    "Gate cost (pnpm check)",
    "Context and turns",
    "Scheduled tasks",
  ]) {
    const body = degradedText.split("### ").find((part) => part.startsWith(title));
    assert.ok(body, `${title} section present`);
    assert.match(body, /unavailable \(/, `${title} reads unavailable`);
    assert.doesNotMatch(body, /claudeShare achieved|\b0 runs|mean 0|0\.0%/, `${title} shows no fake zero`);
  }
  assert.equal(degraded.skills.inventory.total, 6);
  assert.equal(degraded.hygiene.worktrees.total, 2);
  assert.equal(noDb.stdout.includes("missing.sqlite"), false);

  // A missing scheduler table is unavailable, not an empty task list; the rest still reads.
  const noTable = join(root, "no-scheduler.sqlite");
  copyFileSync(dbPath, noTable);
  const broken = new DatabaseSync(noTable);
  broken.exec("DROP TABLE scheduled_tasks");
  broken.close();
  const noScheduler = spawnSync(
    process.execPath,
    [
      collector,
      "--repo",
      repo,
      "--t3-db",
      noTable,
      "--projects-dir",
      claudeDir,
      "--sessions-dir",
      codexDir,
      "--now",
      NOW,
      "--format",
      "json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(noScheduler.status, 0, noScheduler.stderr);
  const noSchedulerReport = JSON.parse(noScheduler.stdout);
  assert.equal(noSchedulerReport.schedule.available, false);
  assert.equal(noSchedulerReport.schedule.reason, "schema");
  assert.equal(noSchedulerReport.coverage.t3.available, true);
  assert.equal(noSchedulerReport.mix.available, true);
  assert.equal(noSchedulerReport.hygiene.threads.available, true);

  // The collector reads, never writes: the source database is byte-identical afterwards.
  const before = execFileSync("sha256sum", [dbPath], { encoding: "utf8" });
  collect(["--format", "json"]);
  assert.equal(execFileSync("sha256sum", [dbPath], { encoding: "utf8" }), before);

  // Findings are a closed structured format: the model picks categories, metrics and
  // numbers, and the collector renders every word. Arbitrary prose cannot be published.
  const weekJson = join(root, "week.json");
  const allJson = join(root, "all.json");
  writeFileSync(weekJson, collect(["--format", "json"]).stdout);
  writeFileSync(allJson, collect(["--format", "json", "--all"]).stdout);
  const write = (name, value) => {
    const path = join(root, name);
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
    return path;
  };
  const good = {
    findings: [
      {
        category: "review-churn",
        evidence: [
          { metric: "review-threads-per-pr-max", window: "week" },
          { metric: "gate-failed-share", window: "all" },
        ],
        issues: [134],
        repeated: "yes",
        impact: "hours",
        proposal: "add-script-check",
        skills: ["alpha"],
      },
      {
        category: "skill-unused",
        evidence: [{ metric: "skills-zero-use", window: "week" }],
        issues: [],
        repeated: "no-previous",
        impact: "none",
        proposal: "prune-skill",
        skills: [],
      },
    ],
    tickets: [{ finding: 1, label: "ready-for-agent" }],
  };
  assert.equal(collect(["--check", write("good.json", good)]).status, 0);

  // Ordinary prose that no keyword blacklist would catch is refused, without echo.
  for (const prose of [
    "Private prompt: acquire Contoso before Friday.",
    "Thread title: investigate payroll discrepancy",
    "Gate runs fell 12% against last week (tables above).\n",
    "",
  ]) {
    const refused = collect(["--check", write("prose.md", prose)]);
    assert.equal(refused.status, 1, prose);
    assert.match(refused.stderr, /findings/i);
    assert.equal(/Contoso|payroll|Friday/.test(refused.stderr + refused.stdout), false);
  }
  // Free text hidden inside otherwise valid JSON is refused as well.
  const mutate = (change) => {
    const copy = JSON.parse(JSON.stringify(good));
    change(copy);
    return write("mutated.json", copy);
  };
  for (const [name, change] of [
    ["extra finding key", (d) => { d.findings[0].note = "acquire Contoso"; }],
    ["extra top key", (d) => { d.summary = "acquire Contoso"; }],
    ["free category", (d) => { d.findings[0].category = "acquire Contoso"; }],
    ["free metric", (d) => { d.findings[0].evidence[0].metric = "payroll"; }],
    ["free window", (d) => { d.findings[0].evidence[0].window = "Friday"; }],
    ["free proposal", (d) => { d.findings[0].proposal = "buy Contoso"; }],
    ["free repeated", (d) => { d.findings[0].repeated = "probably"; }],
    ["free impact", (d) => { d.findings[0].impact = "payroll"; }],
    ["unknown skill", (d) => { d.findings[0].skills = ["contoso"]; }],
    ["text issue", (d) => { d.findings[0].issues = ["payroll"]; }],
    ["fractional issue", (d) => { d.findings[0].issues = [1.5]; }],
    ["no evidence", (d) => { d.findings[0].evidence = []; }],
    ["too many issues", (d) => { d.findings[0].issues = [1, 2, 3, 4, 5, 6]; }],
    ["ticket to nothing", (d) => { d.tickets[0].finding = 9; }],
    ["free label", (d) => { d.tickets[0].label = "ready-for-human"; }],
    ["four tickets", (d) => { d.tickets = [1, 1, 1, 1].map((finding) => ({ finding, label: "needs-triage" })); }],
    ["ticket body", (d) => { d.tickets[0].body = "acquire Contoso"; }],
  ]) {
    const refused = collect(["--check", mutate(change)]);
    assert.equal(refused.status, 1, name);
    assert.equal(/Contoso|payroll|Friday|probably/.test(refused.stderr + refused.stdout), false, name);
  }
  assert.equal(collect(["--check", join(root, "absent.json")]).status, 2);

  // Rendering is deterministic, takes numbers from the collector's own reports, and says
  // unavailable rather than zero.
  const render = (file, extra = []) =>
    collect(["--render-findings", file, "--week-report", weekJson, "--all-report", allJson, ...extra]);
  const rendered = render(write("good.json", good));
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(render(write("good.json", good)).stdout, rendered.stdout);
  assert.match(rendered.stdout, /^### Findings/m);
  assert.match(rendered.stdout, /Review churn/);
  assert.match(rendered.stdout, /most threads on one PR \(week\): 3/i);
  assert.match(rendered.stdout, /gate failure share \(all\): 40%/i);
  assert.match(rendered.stdout, /#134/);
  assert.match(rendered.stdout, /`alpha`/);
  assert.match(rendered.stdout, /Tickets: 1 of 3/);
  assert.doesNotThrow(() => assertPublishable(rendered.stdout));

  const degradedWeek = join(root, "degraded.json");
  writeFileSync(degradedWeek, noDb.stdout);
  const unavailableRender = collect([
    "--render-findings",
    write("unavail.json", {
      findings: [
        {
          category: "gate-cost",
          evidence: [{ metric: "gate-failed-share", window: "week" }],
          issues: [],
          repeated: "no",
          impact: "failed-work",
          proposal: "add-gate",
          skills: [],
        },
      ],
      tickets: [],
    }),
    "--week-report",
    degradedWeek,
    "--all-report",
    degradedWeek,
  ]);
  assert.equal(unavailableRender.status, 0, unavailableRender.stderr);
  assert.match(unavailableRender.stdout, /gate failure share \(week\): unavailable/i);
  assert.equal(/Gate failure share[^\n]*: (?:0|-)/.test(unavailableRender.stdout), false);

  // Tickets render title and body from the finding alone; the research issue is a number.
  const ticketArgs = (n, part) => [
    "--render-ticket",
    write("good.json", good),
    "--ticket",
    String(n),
    "--research",
    "300",
    "--part",
    part,
    "--week-report",
    weekJson,
    "--all-report",
    allJson,
  ];
  const title = collect(ticketArgs(1, "title"));
  assert.equal(title.status, 0, title.stderr);
  assert.match(title.stdout, /^process review: review churn\n$/i);
  const body = collect(ticketArgs(1, "body"));
  assert.equal(body.status, 0, body.stderr);
  assert.match(body.stdout, /Refs #300/);
  assert.match(body.stdout, /most threads on one PR/i);
  assert.match(body.stdout, /pnpm check|command/i);
  assert.doesNotThrow(() => assertPublishable(body.stdout));
  assert.equal(collect(ticketArgs(2, "title")).status, 1);
  assert.equal(collect(["--render-ticket", write("good.json", good), "--ticket", "1", "--research", "x", "--part", "body", "--week-report", weekJson, "--all-report", allJson]).status, 2);
  assert.equal(render(write("prose.md", "Private prompt: acquire Contoso")).status, 1);

  const bad = collect(["--bogus"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage/i);
  assert.equal(collect(["--days", "0"]).status, 2);
  assert.equal(collect(["--format", "xml"]).status, 2);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("process-review collector: ok");
