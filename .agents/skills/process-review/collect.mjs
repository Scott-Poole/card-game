#!/usr/bin/env node
// Collects the weekly process-review measures from T3 threads, Claude Code and Codex
// transcripts and the git checkout, and prints aggregate tables. Read-only; prints counts
// and ratios, never prompt text, paths or titles. See SKILL.md.
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { FindingsError, parseFindings, renderFindings, renderTicket } from "./findings.mjs";
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
       collect.mjs --check FILE   (exit 1 unless FILE is the structured findings format)
       collect.mjs --render-findings FILE --week-report FILE --all-report FILE
       collect.mjs --render-ticket FILE --ticket N --research N --part title|label|body
                   --week-report FILE --all-report FILE   (reports are --format json output)`;

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
    renderFindings: null,
    renderTicket: null,
    ticket: null,
    research: null,
    part: null,
    weekReport: null,
    allReport: null,
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
    "--render-findings": "renderFindings",
    "--render-ticket": "renderTicket",
    "--ticket": "ticket",
    "--research": "research",
    "--part": "part",
    "--week-report": "weekReport",
    "--all-report": "allReport",
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

function readText(path, what) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fail(`${what} could not read its file`);
  }
}

function readReports() {
  if (options.weekReport === null || options.allReport === null) {
    fail("rendering needs --week-report and --all-report");
  }
  const load = (path) => {
    try {
      const report = JSON.parse(readText(path, "--week-report/--all-report"));
      if (report === null || typeof report !== "object" || Array.isArray(report)) throw new Error("shape");
      return report;
    } catch {
      return fail("a report file is not collector --format json output");
    }
  };
  return { week: load(options.weekReport), all: load(options.allReport) };
}

// Findings are validated against the closed format, then rendered by this program alone.
const findingsFile = options.check ?? options.renderFindings ?? options.renderTicket;
if (findingsFile !== null) {
  const text = readText(findingsFile, "the findings file");
  const skillNames = readSkills(options.repo).skills.map((skill) => skill.name);
  let output = "";
  try {
    const document = parseFindings(text, skillNames);
    if (options.renderFindings !== null) {
      output = renderFindings(document, readReports());
    } else if (options.renderTicket !== null) {
      const ticket = Number(options.ticket);
      const research = Number(options.research);
      if (!Number.isInteger(ticket) || ticket < 1) fail("--ticket must be a positive integer");
      if (!Number.isInteger(research) || research < 1) fail("--research must be an issue number");
      if (!["title", "label", "body"].includes(options.part)) fail("--part must be title, label or body");
      output = renderTicket(document, ticket, research, options.part, readReports());
    }
    assertPublishable(output);
  } catch (error) {
    if (!(error instanceof FindingsError) && !/^refusing to publish/.test(error.message)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  process.stdout.write(output);
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
