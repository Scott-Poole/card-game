// Pure helpers for the process-review collector: statistics, command and role
// classification, and the privacy rule every published value passes.

// Nearest-rank percentile; null for no values.
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarize(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    n: values.length,
    total,
    mean: values.length === 0 ? null : total / values.length,
    median: median(values),
    p90: percentile(values, 0.9),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

export function round(value, places = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function share(part, whole) {
  return whole === 0 ? null : part / whole;
}

// Source values reach the report only as a token of this shape; anything else is "other".
export function safeToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,47}$/.test(value)
    ? value
    : "other";
}

// A shell command with its `bash -lc '...'` wrapper removed and quoted strings blanked,
// so quoted prose cannot pose as a command.
function commandSegments(command) {
  let text = command;
  const wrapper = /^\s*(?:\/\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/;
  for (let match = wrapper.exec(text); match; match = wrapper.exec(text)) {
    text = match[2];
  }
  // Drop heredoc bodies (their lines are data); an unterminated one hides the rest.
  text = text.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, "");
  const open = text.indexOf("<<");
  if (open !== -1) text = text.slice(0, open);
  return text
    .replace(/'[^']*'|"[^"]*"/g, '""')
    .split(/&&|\|\||;|\n|\|/)
    .map((segment) => segment.trim());
}

const gateStart =
  /^(?:time\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:pnpm(?:\s+run)?\s+check|node\s+scripts\/check\.mjs)(?=\s|$)/;

// True when the command text mentions the gate anywhere: the loose count older audits used.
export function mentionsGate(command) {
  return /\bpnpm\s+(?:run\s+)?check(?![\w:-])/.test(command);
}

// True when the command runs the full local gate.
export function isGateCommand(command) {
  return commandSegments(command).some((segment) => gateStart.test(segment));
}

const readVerb = /\b(?:cat|sed|head|tail|nl|less|more|bat|awk|rg|grep|wc)\b|\bgit\s+show\b/;
const skillPath = /skills\/([a-z0-9][a-z0-9_-]*)\/SKILL\.md/g;

// Skill names whose SKILL.md the command reads. Writes and git bookkeeping are not loads.
export function skillsFromCommand(command) {
  if (!readVerb.test(command)) return [];
  if (/\bsed\s+(?:-\S*\s+)*-[a-zA-Z]*i/.test(command)) return [];
  const names = [];
  for (const match of command.matchAll(skillPath)) {
    const before = command.slice(0, match.index);
    if (/(?:>|\btee\b)\s*\S*$/.test(before)) continue;
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

// File paths a read-like tool names, reduced to skill names.
export function skillsFromPath(path) {
  if (typeof path !== "string") return [];
  const match = /skills\/([a-z0-9][a-z0-9_-]*)\/SKILL\.md$/.exec(path);
  return match ? [match[1]] : [];
}

const rolePatterns = [
  ["review", /^Act as the review sub-agent/],
  ["research", /^Act as the research sub-agent/],
  ["implement", /^Act as the implementation sub-agent|^Work GitHub issue #\d+/],
  ["plan", /planner for planning issue/],
  ["tick", /^(?:Load|Run|Read)\b[^\n]{0,40}`tick`|^Run the tick\b/],
  [
    "triage",
    /^(?:Run nightly ticket triage|Read \.agents\/skills\/triage\/|Run the dedicated per-ticket flow)/,
  ],
  ["audit", /^Run the merge audit/],
  ["read-only", /^Run the `read-main`|^Read-only task/],
];
const roleSkills = new Map([
  ["tick", "tick"],
  ["work-ticket", "implement"],
  ["plan", "plan"],
]);

// Reduces a thread to a role label. The first message is read here and never stored.
export function classifyRole({ firstMessage, createdBy, skills }) {
  const text = typeof firstMessage === "string" ? firstMessage.trimStart() : "";
  for (const [role, pattern] of rolePatterns) {
    if (pattern.test(text)) return role;
  }
  if (createdBy === "user") return "interactive";
  for (const skill of skills ?? []) {
    const role = roleSkills.get(skill);
    if (role !== undefined) return role;
  }
  return "other";
}

const publishRules = [
  ["absolute path", /(?:^|[\s("'`=])\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]|(?:^|[\s("'`=])~\//],
  ["windows path", /[A-Za-z]:\\/],
  ["url", /\b[a-z][a-z0-9+.-]*:\/\//i],
  ["email address", /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ["long hex id", /\b[0-9a-f]{24,}\b/i],
  ["data file name", /\.(?:sqlite|jsonl)\b/i],
  ["non-ascii text", /[^\x20-\x7e\n]/],
];

// Throws when text could carry source data. The message names the rule, never the value.
export function assertPublishable(text) {
  for (const [name, pattern] of publishRules) {
    if (pattern.test(text)) {
      throw new Error(`refusing to publish: output matches the ${name} rule`);
    }
  }
}
