// Read-only readers for the data the process review mines. Each returns plain records with
// source text already reduced: a first message becomes a role, a command becomes a flag, a
// path becomes a skill name. Nothing here is printed; report.mjs only counts what it gets.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  classifyRole,
  isGateCommand,
  mentionsGate,
  safeToken,
  skillsFromCommand,
  skillsFromPath,
} from "./lib.mjs";

const launchTools = /(?:^|[._])(?:t3_thread_launch|create_threads)$/;

function parseJson(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function millis(from, to) {
  const start = Date.parse(from ?? "");
  const end = Date.parse(to ?? "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? end - start
    : null;
}

// ------------------------------------------------------------------- T3 database

// Opens the database read-only. When a live server blocks that, reads a private copy.
function openReadOnly(path) {
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    db.prepare("SELECT 1 FROM sqlite_master LIMIT 1").get();
    return { db, cleanup: () => db.close() };
  } catch {
    const directory = mkdtempSync(join(tmpdir(), "process-review-"));
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        if (existsSync(path + suffix)) {
          copyFileSync(path + suffix, join(directory, `copy.sqlite${suffix}`));
        }
      }
      const db = new DatabaseSync(join(directory, "copy.sqlite"), { readOnly: true });
      return {
        db,
        cleanup: () => {
          db.close();
          rmSync(directory, { recursive: true, force: true });
        },
      };
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }
}

function pullRequestNumbers(payloadPullRequests, linked, repoName) {
  const numbers = new Set();
  const consider = (entry) => {
    if (entry === null || typeof entry !== "object") return;
    const repository = typeof entry.repository === "string" ? entry.repository : null;
    if (repository !== null && repository !== repoName && !repository.endsWith(`/${repoName}`)) {
      return;
    }
    if (Number.isInteger(entry.number) && entry.number > 0) numbers.add(entry.number);
  };
  const list = parseJson(payloadPullRequests);
  if (Array.isArray(list)) list.forEach(consider);
  consider(parseJson(linked));
  return [...numbers].sort((a, b) => a - b);
}

export function readT3({ dbPath, repoName }) {
  if (!existsSync(dbPath)) return { available: false, reason: "missing" };
  let handle;
  try {
    handle = openReadOnly(dbPath);
  } catch {
    return { available: false, reason: "unreadable" };
  }
  const { db, cleanup } = handle;
  try {
    const projects = db
      .prepare(
        "SELECT project_id FROM projection_projects WHERE deleted_at IS NULL AND (title = ? OR workspace_root LIKE ?)",
      )
      .all(repoName, `%/${repoName}`)
      .map((row) => row.project_id);
    if (projects.length === 0) return { available: false, reason: "no-project" };
    const marks = projects.map(() => "?").join(",");
    const mine = `(SELECT thread_id FROM orchestration_v2_projection_threads WHERE project_id IN (${marks}) AND deleted_at IS NULL)`;

    const threads = new Map();
    for (const row of db
      .prepare(
        `SELECT thread_id, default_provider, created_at, archived_at,
           json_extract(payload_json, '$.createdBy') AS created_by,
           json_extract(payload_json, '$.pullRequests') AS pull_requests,
           json_extract(payload_json, '$.linkedPullRequest') AS linked,
           json_extract(payload_json, '$.settledOverride') AS settled,
           json_extract(payload_json, '$.lineage.parentThreadId') AS parent
         FROM orchestration_v2_projection_threads
         WHERE project_id IN (${marks}) AND deleted_at IS NULL`,
      )
      .all(...projects)) {
      threads.set(row.thread_id, {
        key: row.thread_id,
        provider: safeToken(row.default_provider),
        createdAt: row.created_at,
        archived: row.archived_at !== null,
        settled: row.settled === "settled",
        createdBy: row.created_by,
        parent: typeof row.parent === "string" ? row.parent : null,
        prs: pullRequestNumbers(row.pull_requests, row.linked, repoName),
        firstMessage: "",
        runs: [],
        skillLoads: [],
        gates: [],
        launchRunIds: new Set(),
        peakTokens: null,
        peakWindow: null,
        turns: 0,
        nativeIds: [],
      });
    }

    const seenFirst = new Set();
    for (const row of db
      .prepare(
        `SELECT thread_id, substr(json_extract(payload_json, '$.text'), 1, 200) AS text
         FROM orchestration_v2_projection_turn_items
         WHERE type = 'user_message' AND thread_id IN ${mine} ORDER BY ordinal`,
      )
      .all(...projects)) {
      if (seenFirst.has(row.thread_id)) continue;
      seenFirst.add(row.thread_id);
      threads.get(row.thread_id).firstMessage = row.text ?? "";
    }

    const failureClass = new Map();
    for (const row of db
      .prepare(
        `SELECT run_id, json_extract(payload_json, '$.failure.class') AS class
         FROM orchestration_v2_projection_turn_items
         WHERE type = 'error' AND run_id IS NOT NULL AND thread_id IN ${mine}`,
      )
      .all(...projects)) {
      if (!failureClass.has(row.run_id)) failureClass.set(row.run_id, row.class);
    }
    for (const row of db
      .prepare(
        `SELECT run_id, thread_id, provider, status, requested_at, completed_at,
           json_extract(payload_json, '$.startedAt') AS started_at,
           json_extract(payload_json, '$.modelSelection.model') AS model
         FROM orchestration_v2_projection_runs WHERE thread_id IN ${mine}`,
      )
      .all(...projects)) {
      threads.get(row.thread_id).runs.push({
        id: row.run_id,
        provider: safeToken(row.provider),
        status: safeToken(row.status),
        requestedAt: row.requested_at,
        model: safeToken(row.model),
        durationMs: row.completed_at === null ? null : millis(row.started_at ?? row.requested_at, row.completed_at),
        failureClass:
          row.status === "failed"
            ? failureClass.has(row.run_id)
              ? safeToken(failureClass.get(row.run_id))
              : "unclassified"
            : null,
      });
    }

    for (const row of db
      .prepare(
        `SELECT thread_id, run_id, updated_at,
           json_extract(payload_json, '$.toolName') AS tool,
           json_extract(payload_json, '$.input.skill') AS skill,
           COALESCE(json_extract(payload_json, '$.input.file_path'),
                    json_extract(payload_json, '$.input.filePath'),
                    json_extract(payload_json, '$.input.path')) AS path,
           json_extract(payload_json, '$.nativeItemRef.driver') AS driver
         FROM orchestration_v2_projection_turn_items
         WHERE type = 'dynamic_tool' AND thread_id IN ${mine}`,
      )
      .all(...projects)) {
      const thread = threads.get(row.thread_id);
      const provider = safeToken(row.driver ?? thread.provider);
      if (typeof row.tool === "string" && launchTools.test(row.tool)) {
        thread.launchRunIds.add(row.run_id);
      }
      const names =
        row.tool === "Skill" && typeof row.skill === "string"
          ? [row.skill]
          : skillsFromPath(row.path);
      for (const name of names) {
        thread.skillLoads.push({ name, provider, at: row.updated_at });
      }
    }

    for (const row of db
      .prepare(
        `SELECT thread_id, status, updated_at, input,
           json_extract(payload_json, '$.startedAt') AS started_at,
           json_extract(payload_json, '$.completedAt') AS completed_at,
           json_extract(payload_json, '$.nativeItemRef.driver') AS driver
         FROM (SELECT thread_id, status, updated_at, payload_json,
                 json_extract(payload_json, '$.input') AS input
               FROM orchestration_v2_projection_turn_items
               WHERE type = 'command_execution' AND thread_id IN ${mine})
         WHERE input LIKE '%pnpm%' OR input LIKE '%check.mjs%' OR input LIKE '%SKILL.md%'`,
      )
      .all(...projects)) {
      if (typeof row.input !== "string") continue;
      const thread = threads.get(row.thread_id);
      const provider = safeToken(row.driver ?? thread.provider);
      const at = row.started_at ?? row.updated_at;
      for (const name of skillsFromCommand(row.input)) {
        thread.skillLoads.push({ name, provider, at });
      }
      if (mentionsGate(row.input)) {
        thread.gates.push({
          at,
          strict: isGateCommand(row.input),
          status: safeToken(row.status),
          ms: millis(row.started_at, row.completed_at),
        });
      }
    }

    for (const row of db
      .prepare(
        `SELECT thread_id, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS native
         FROM orchestration_v2_projection_provider_threads WHERE thread_id IN ${mine}`,
      )
      .all(...projects)) {
      if (typeof row.native === "string") threads.get(row.thread_id).nativeIds.push(row.native);
    }
    for (const row of db
      .prepare(
        `SELECT thread_id,
           json_extract(payload_json, '$.tokenUsage.usedTokens') AS used,
           json_extract(payload_json, '$.tokenUsage.maxTokens') AS max
         FROM orchestration_v2_projection_provider_turns WHERE thread_id IN ${mine}`,
      )
      .all(...projects)) {
      const thread = threads.get(row.thread_id);
      thread.turns += 1;
      if (Number.isFinite(row.used) && (thread.peakTokens === null || row.used > thread.peakTokens)) {
        thread.peakTokens = row.used;
        thread.peakWindow = Number.isFinite(row.max) ? row.max : null;
      }
    }

    for (const thread of threads.values()) {
      for (const run of thread.runs) run.launched = thread.launchRunIds.has(run.id);
      // A delegated child belongs to the PR its nearest ancestor with one is linked to.
      thread.inheritedPrs = [];
      const seen = new Set([thread.key]);
      let ancestor = thread.prs.length === 0 ? threads.get(thread.parent) : undefined;
      while (ancestor !== undefined && !seen.has(ancestor.key)) {
        if (ancestor.prs.length > 0) {
          thread.inheritedPrs = ancestor.prs;
          break;
        }
        seen.add(ancestor.key);
        ancestor = threads.get(ancestor.parent);
      }
      thread.role = classifyRole({
        firstMessage: thread.firstMessage,
        createdBy: thread.createdBy,
        skills: thread.skillLoads.map((load) => load.name),
      });
      thread.firstMessage = "";
    }

    let tasks = [];
    try {
      tasks = db
        .prepare(
          `SELECT enabled, schedule_json, thread_mode, run_count, last_run_status
           FROM scheduled_tasks WHERE project_id IN (${marks})`,
        )
        .all(...projects)
        .map((row) => {
          const schedule = parseJson(row.schedule_json) ?? {};
          return {
            kind: safeToken(schedule.type),
            everyHours: Number.isFinite(schedule.everyMs) ? schedule.everyMs / 3600000 : null,
            threadMode: safeToken(row.thread_mode),
            enabled: row.enabled === 1,
            runCount: Number.isFinite(row.run_count) ? row.run_count : 0,
            lastStatus: safeToken(row.last_run_status),
          };
        });
    } catch {
      tasks = [];
    }

    const size = (suffix) => {
      try {
        return statSync(dbPath + suffix).size;
      } catch {
        return 0;
      }
    };
    return {
      available: true,
      threads: [...threads.values()],
      tasks,
      dbBytes: size(""),
      walBytes: size("-wal"),
    };
  } catch {
    return { available: false, reason: "schema" };
  } finally {
    cleanup();
  }
}

// ------------------------------------------------------------ transcript directories

function walk(directory, extension, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, extension, found);
    else if (entry.isFile() && entry.name.endsWith(extension)) found.push(path);
  }
  return found;
}

function lines(path) {
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch {
    return [];
  }
}

const timestampPattern = /"timestamp":"([^"]+)"/;

// Claude Code transcripts for this repo. Sessions the T3 database already knows contribute
// only a cost and a last-seen time; sessions outside T3 are read in full.
export function readClaude({ dir, repoName, linkedIds }) {
  if (!existsSync(dir)) return { available: false, reason: "missing" };
  let projectDirs;
  try {
    projectDirs = readdirSync(dir, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && entry.name.includes(repoName),
    );
  } catch {
    return { available: false, reason: "unreadable" };
  }
  const sessions = [];
  for (const projectDir of projectDirs) {
    for (const file of walk(join(dir, projectDir.name), ".jsonl")) {
      const id = basename(file, ".jsonl");
      const linked = linkedIds.has(id);
      const session = {
        id,
        linked,
        firstAt: null,
        lastAt: null,
        cost: null,
        peakContext: null,
        skillLoads: [],
        gates: [],
      };
      const calls = new Map();
      for (const line of lines(file)) {
        if (line === "") continue;
        const stamp = timestampPattern.exec(line)?.[1];
        if (stamp !== undefined) {
          session.firstAt ??= stamp;
          session.lastAt = stamp;
        }
        const costLine = line.includes('"type":"cost-state"');
        if (!costLine && linked) continue;
        const entry = parseJson(line);
        if (entry === null) continue;
        if (costLine) {
          if (Number.isFinite(entry.totalCostUSD)) {
            const models = {};
            for (const [model, usage] of Object.entries(entry.modelUsage ?? {})) {
              if (Number.isFinite(usage?.costUSD)) models[safeToken(model)] = usage.costUSD;
            }
            session.cost = { usd: entry.totalCostUSD, models };
          }
          continue;
        }
        const message = entry.message;
        if (entry.type === "assistant" && message !== undefined) {
          const usage = message.usage;
          if (usage !== undefined && usage !== null) {
            const context =
              (usage.input_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0);
            if (session.peakContext === null || context > session.peakContext) {
              session.peakContext = context;
            }
          }
          for (const block of Array.isArray(message.content) ? message.content : []) {
            if (block?.type !== "tool_use") continue;
            const input = block.input ?? {};
            if (block.name === "Skill" && typeof input.skill === "string") {
              session.skillLoads.push({ name: input.skill, provider: "claudeAgent", at: stamp });
            } else if (block.name === "Read") {
              for (const name of skillsFromPath(input.file_path)) {
                session.skillLoads.push({ name, provider: "claudeAgent", at: stamp });
              }
            } else if (block.name === "Bash" && typeof input.command === "string") {
              for (const name of skillsFromCommand(input.command)) {
                session.skillLoads.push({ name, provider: "claudeAgent", at: stamp });
              }
              if (isGateCommand(input.command)) calls.set(block.id, stamp);
            }
          }
        } else if (entry.type === "user" && Array.isArray(message?.content)) {
          for (const block of message.content) {
            if (block?.type === "tool_result" && calls.has(block.tool_use_id)) {
              session.gates.push({
                at: calls.get(block.tool_use_id),
                strict: true,
                status: block.is_error === true ? "failed" : "completed",
                ms: millis(calls.get(block.tool_use_id), stamp),
              });
              calls.delete(block.tool_use_id);
            }
          }
        }
      }
      sessions.push(session);
    }
  }
  return { available: true, sessions };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Codex session files whose working directory belongs to this repo. Linked sessions give
// rate-limit samples; sessions outside T3 also give skill loads.
export function readCodex({ dir, repoName, linkedIds }) {
  if (!existsSync(dir)) return { available: false, reason: "missing" };
  const inRepo = new RegExp(`(?:^|/)${escapeRegExp(repoName)}(?:/|$)`);
  const sessions = [];
  for (const file of walk(dir, ".jsonl")) {
    const all = lines(file);
    const meta = parseJson(all[0]);
    const cwd = meta?.payload?.cwd;
    if (typeof cwd !== "string" || !inRepo.test(cwd)) continue;
    const id = String(meta.payload.id ?? basename(file, ".jsonl"));
    const linked = linkedIds.has(id);
    const session = { id, linked, firstAt: meta.timestamp ?? null, samples: [], skillLoads: [] };
    for (const line of all.slice(1)) {
      if (line === "") continue;
      const wantsSample = line.includes('"token_count"');
      const wantsCall = !linked && /"(?:custom_tool_call|function_call)"/.test(line);
      if (!wantsSample && !wantsCall) continue;
      const entry = parseJson(line);
      const payload = entry?.payload;
      if (payload === undefined) continue;
      if (payload.type === "token_count" && payload.rate_limits) {
        session.samples.push({
          at: entry.timestamp,
          primary: Number(payload.rate_limits.primary?.used_percent ?? 0),
          secondary: Number(payload.rate_limits.secondary?.used_percent ?? 0),
        });
      } else if (payload.type === "custom_tool_call" || payload.type === "function_call") {
        const raw = payload.type === "custom_tool_call" ? payload.input : payload.arguments;
        const parsed = typeof raw === "string" ? parseJson(raw) : null;
        const text =
          typeof parsed?.cmd === "string"
            ? parsed.cmd
            : typeof parsed?.command === "string"
              ? parsed.command
              : String(raw ?? "");
        for (const name of skillsFromCommand(text)) {
          session.skillLoads.push({ name, provider: "codex", at: entry.timestamp });
        }
      }
    }
    sessions.push(session);
  }
  return { available: true, sessions };
}

// ------------------------------------------------------------------ repo and git

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  if (match === null) return {};
  const fields = {};
  const body = match[1].split("\n");
  for (let index = 0; index < body.length; index += 1) {
    const field = /^([A-Za-z-]+):\s*(.*)$/.exec(body[index]);
    if (field === null) continue;
    let value = field[2];
    if (/^[>|][+-]?$/.test(value)) {
      const parts = [];
      while (index + 1 < body.length && /^\s+\S/.test(body[index + 1])) {
        index += 1;
        parts.push(body[index].trim());
      }
      value = parts.join(" ");
    } else {
      value = value.replace(/^(['"])([\s\S]*)\1$/, "$2");
    }
    fields[field[1]] = value;
  }
  return fields;
}

export function readSkills(repo) {
  const root = join(repo, ".agents", "skills");
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return { available: false, skills: [] };
  }
  const skills = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    let text;
    try {
      text = readFileSync(join(root, entry.name, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const fields = frontmatter(text);
    const user = fields["disable-model-invocation"] === "true";
    skills.push({
      name: entry.name,
      invocation: user ? "user" : "model",
      descriptionChars: user ? 0 : (fields.description ?? "").length,
    });
  }
  return { available: true, skills };
}

export function readTarget(repo) {
  try {
    const config = JSON.parse(
      readFileSync(join(repo, ".agents", "skills", "tick", "config.json"), "utf8"),
    );
    const target = config?.implement?.claudeShare;
    return typeof target === "number" ? target : null;
  } catch {
    return null;
  }
}

function git(args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  return execFileSync("git", args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 30000,
  });
}

function succeeds(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

const branchPrefixes = new Set(["ticket", "plan", "t3"]);

function localBranches(repo) {
  try {
    return git([
      "-C",
      repo,
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
    ])
      .split("\n")
      .filter((name) => name !== "");
  } catch {
    return [];
  }
}

export function readHygiene(repo) {
  let primary;
  let listing;
  try {
    listing = git(["-C", repo, "worktree", "list", "--porcelain"]);
    primary = realpathSync(repo);
  } catch {
    return { available: false };
  }
  const entries = listing
    .split("\n\n")
    .map((block) => {
      const fields = {};
      for (const line of block.split("\n")) {
        const [key, ...rest] = line.split(" ");
        if (key !== "") fields[key] = rest.join(" ");
      }
      return fields;
    })
    .filter((entry) => entry.worktree !== undefined);
  const hasMain = succeeds(["-C", repo, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]);
  const merged = (ref) =>
    hasMain && succeeds(["-C", repo, "merge-base", "--is-ancestor", ref, "refs/remotes/origin/main"]);
  const worktrees = { total: 0, merged: 0, dirty: 0, prunable: 0 };
  entries.forEach((entry, index) => {
    let path = entry.worktree;
    try {
      path = realpathSync(entry.worktree);
    } catch {
      // A prunable worktree has no directory left to resolve.
    }
    if (index === 0 || path === primary) return;
    worktrees.total += 1;
    if (entry.prunable !== undefined) {
      worktrees.prunable += 1;
      return;
    }
    if (entry.HEAD !== undefined && merged(entry.HEAD)) worktrees.merged += 1;
    try {
      if (git(["-C", path, "status", "--porcelain"]).trim() !== "") worktrees.dirty += 1;
    } catch {
      // An unreadable worktree is not counted as dirty.
    }
  });
  const heads = localBranches(repo);
  const leftovers = heads.filter((name) => name !== "main" && name !== "master");
  const byPrefix = {};
  let mergedBranches = 0;
  for (const name of leftovers) {
    const prefix = name.includes("/") ? name.split("/")[0] : "";
    const key = branchPrefixes.has(prefix) ? prefix : "other";
    byPrefix[key] = (byPrefix[key] ?? 0) + 1;
    if (merged(`refs/heads/${name}`)) mergedBranches += 1;
  }
  return {
    available: true,
    worktrees,
    branches: { total: leftovers.length, merged: mergedBranches, byPrefix, comparedToOriginMain: hasMain },
  };
}

export function repoName(repo) {
  try {
    const common = git(["-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
    return basename(join(common, ".."));
  } catch {
    return basename(repo);
  }
}
