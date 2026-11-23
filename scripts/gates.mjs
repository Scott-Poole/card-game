// The ordered list of gates `pnpm check` runs, shared with scripts/test-gates.mjs so
// the suite compares the real list to package.json instead of parsing check.mjs text.
export const gates = [
  "typecheck",
  "lint",
  "format:check",
  "test",
  "test:guardrail",
  "test:queue",
  "test:routing",
  "test:label-issues",
  "test:triage-finder",
  "test:read-main",
  "test:boundaries",
  "test:runners",
  "test:ci-artifacts",
  "test:skill-links",
  "test:working-markdown",
  "test:gates",
  "build-storybook",
  "test:stories",
  "test:browser",
];

// Scripts the gate rule would otherwise demand but that deliberately stay out of
// `pnpm check`. Each entry needs a comment saying why. Empty today.
export const exemptScripts = [];

// Scripts that verify the tree and so must be a gate: these names, and any `test:*`.
export function isGateScript(name) {
  return (
    ["typecheck", "lint", "format:check", "test"].includes(name) ||
    name.startsWith("test:")
  );
}

// AGENTS.md describes `pnpm check` in kind and points here for the exact list. These
// helpers keep that bullet from restating the list, which drifted every time a gate landed.
const checkBulletStart = "- `pnpm check`:";

// The whole list item: its first line, wrapped continuation lines and indented nested
// content, up to the next top-level list marker, heading, or a blank line followed by
// unindented text. Wrapping or nesting neither hides a gate name nor the pointer.
export function checkBullet(agents) {
  const lines = agents.split("\n").map((line) => line.replace(/\r$/, ""));
  const start = lines.findIndex((line) => line.startsWith(checkBulletStart));
  if (start === -1) return undefined;
  let end = start + 1;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") {
      const next = lines.slice(i + 1).find((later) => later.trim() !== "");
      if (next === undefined || !/^\s/.test(next)) break;
      continue;
    }
    if (/^(?:[-*+]|\d+[.)])\s|^#{1,6}\s/.test(line)) break;
    end = i + 1;
  }
  return lines.slice(start, end).join("\n");
}

// Gate names that are not bare English words (`lint`, `test`): `test:*`, `format:check`,
// `build-storybook`.
export function isNamedGate(name) {
  return /[:-]/.test(name);
}

// Returns one message per way the AGENTS.md `pnpm check` bullet breaks that rule.
export function findAgentsDrift({ agents, gates }) {
  const bullet = checkBullet(agents);
  if (bullet === undefined) {
    return [`AGENTS.md has no line starting with ${checkBulletStart}`];
  }
  const problems = [];
  if (!bullet.includes("scripts/gates.mjs")) {
    problems.push(
      "the AGENTS.md `pnpm check` bullet must point at scripts/gates.mjs for the exact gate list",
    );
  }
  for (const gate of gates.filter(isNamedGate)) {
    const escaped = gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![\\w:-])${escaped}(?![\\w:-])`).test(bullet)) {
      problems.push(
        `the AGENTS.md \`pnpm check\` bullet names "${gate}"; describe the gates in kind and leave the list to scripts/gates.mjs`,
      );
    }
  }
  return problems;
}

// Returns one message per way the gate list and package.json scripts disagree.
export function findGateDrift({ gates, scripts, exempt }) {
  const problems = [];
  const seen = new Set();
  for (const gate of gates) {
    if (seen.has(gate)) {
      problems.push(`"${gate}" appears in the gate list more than once`);
    }
    seen.add(gate);
    if (!Object.hasOwn(scripts, gate)) {
      problems.push(
        `"${gate}" is in the gate list but package.json has no such script`,
      );
    }
  }
  for (const name of Object.keys(scripts)) {
    if (isGateScript(name) && !seen.has(name) && !exempt.includes(name)) {
      problems.push(
        `"${name}" is a package.json script missing from the gate list in scripts/gates.mjs (add it, or exempt it with a reason in exemptScripts)`,
      );
    }
  }
  return problems;
}
