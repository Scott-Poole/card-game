// The ordered list of gates `pnpm check` runs, shared with scripts/test-gates.mjs so
// the suite compares the real list to package.json instead of parsing check.mjs text.
export const gates = [
  "typecheck",
  "lint",
  "format:check",
  "test",
  "test:guardrail",
  "test:queue",
  "test:read-main",
  "test:boundaries",
  "test:skill-links",
  "test:working-markdown",
  "test:gates",
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

// Returns one message per way the gate list and package.json scripts disagree.
export function findGateDrift({ gates, scripts, exempt = exemptScripts }) {
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
