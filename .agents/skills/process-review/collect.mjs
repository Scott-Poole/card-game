#!/usr/bin/env node
// Collects the weekly process-review measures from T3 threads, Claude Code and Codex
// transcripts and the git checkout, and prints aggregate tables. Read-only; prints counts
// and ratios, never prompt text, paths or titles. See SKILL.md.
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { assertPublishable } from "./lib.mjs";
import { publishReport } from "./render.mjs";
import { buildReport, linkedIdsFrom } from "./report.mjs";
import {
  readClaude,
  readCodex,
  readHygiene,
  readSkills,
  readT3,
  readTarget,
  repoName,
} from "./sources.mjs";

const usage = `usage: collect.mjs [--days N | --all] [--format markdown|json] [--now ISO]
                   [--repo PATH] [--t3-db PATH] [--projects-dir PATH] [--sessions-dir PATH]
       collect.mjs --check FILE   (exit 1 when FILE could carry source text)`;

function fail(message) {
  process.stderr.write(`${message}\n${usage}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  const options = {
    days: 7,
    all: false,
    format: "markdown",
    now: new Date().toISOString(),
    repo: process.cwd(),
    t3Db: join(homedir(), ".t3", "userdata", "statev2.sqlite"),
    claudeDir: join(homedir(), ".claude", "projects"),
    codexDir: join(homedir(), ".codex", "sessions"),
    check: null,
  };
  const valued = {
    "--days": "days",
    "--format": "format",
    "--now": "now",
    "--repo": "repo",
    "--t3-db": "t3Db",
    "--projects-dir": "claudeDir",
    "--sessions-dir": "codexDir",
    "--check": "check",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--all") {
      options.all = true;
    } else if (Object.hasOwn(valued, flag)) {
      index += 1;
      if (index >= argv.length) fail(`${flag} needs a value`);
      options[valued[flag]] = argv[index];
    } else {
      fail(`unknown argument ${flag}`);
    }
  }
  options.days = Number(options.days);
  if (!Number.isInteger(options.days) || options.days < 1) fail("--days must be a positive integer");
  if (!["markdown", "json"].includes(options.format)) fail("--format must be markdown or json");
  if (!Number.isFinite(Date.parse(options.now))) fail("--now must be an ISO timestamp");
  options.repo = realpathSync(resolve(options.repo));
  return options;
}

const options = parseArguments(process.argv.slice(2));
if (options.check !== null) {
  // Findings the review writes itself pass the same rules as the collector's tables.
  let text;
  try {
    text = readFileSync(options.check, "utf8");
  } catch {
    fail("--check could not read its file");
  }
  try {
    assertPublishable(text);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  process.exit(0);
}
const name = repoName(options.repo);
const t3 = readT3({ dbPath: options.t3Db, repoName: name });
const linkedIds = linkedIdsFrom(t3);
const report = buildReport({
  now: options.now,
  days: options.days,
  all: options.all,
  t3,
  claude: readClaude({ dir: options.claudeDir, repoName: name, linkedIds }),
  codex: readCodex({ dir: options.codexDir, repoName: name, linkedIds }),
  skills: readSkills(options.repo),
  hygiene: readHygiene(options.repo),
  target: readTarget(options.repo),
});

let text;
try {
  text = publishReport(report, options.format);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "refusing to publish"}\n`);
  process.exit(1);
}
process.stdout.write(text);
