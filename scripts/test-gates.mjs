import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import {
  checkBullet,
  exemptScripts,
  findAgentsDrift,
  findGateDrift,
  gates,
  isGateScript,
  isNamedGate,
} from "./gates.mjs";

// With path arguments (package.json, then AGENTS.md) the suite checks those files against
// the real gate list and exits; without them it checks the repo's own, then proves the
// check bites.
const [packageTarget, agentsTarget] = process.argv.slice(2);
const target = packageTarget !== undefined;
const packageJson = packageTarget
  ? pathToFileURL(resolve(packageTarget))
  : new URL("../package.json", import.meta.url);
const agentsFile = agentsTarget
  ? pathToFileURL(resolve(agentsTarget))
  : new URL("../AGENTS.md", import.meta.url);
const { scripts } = JSON.parse(await readFile(packageJson, "utf8"));
const agents = await readFile(agentsFile, "utf8");
const drift = [
  ...findGateDrift({ gates, scripts, exempt: exemptScripts }),
  ...findAgentsDrift({ agents, gates }),
];
assert.deepEqual(drift, [], drift.join("\n"));
if (target) process.exit(0);

// Fixture package.json files, run through this same script as a child process.
const self = fileURLToPath(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "gate-list-"));
async function run(name, fixtureScripts, fixtureAgents = agents) {
  const file = join(directory, `${name}.json`);
  const agentsCopy = join(directory, `${name}.AGENTS.md`);
  await writeFile(file, JSON.stringify({ scripts: fixtureScripts }));
  await writeFile(agentsCopy, fixtureAgents);
  return spawnSync(process.execPath, [self, file, agentsCopy], {
    encoding: "utf8",
  });
}
try {
  let result = await run("example", { ...scripts, "test:example": "true" });
  assert.notEqual(
    result.status,
    0,
    "an unlisted test:example script must fail",
  );
  assert.match(
    result.stderr,
    /"test:example" is a package\.json script missing/,
  );

  const withoutQueue = { ...scripts };
  delete withoutQueue["test:queue"];
  result = await run("ghost", withoutQueue);
  assert.notEqual(result.status, 0, "a gate with no script must fail");
  assert.match(
    result.stderr,
    /"test:queue" is in the gate list but package\.json has no such script/,
  );

  const bullet = checkBullet(agents);
  result = await run(
    "named",
    scripts,
    agents.replace(bullet, `${bullet} Also runs test:queue.`),
  );
  assert.notEqual(result.status, 0, "a gate named in AGENTS.md must fail");
  assert.match(result.stderr, /names "test:queue"/);

  result = await run(
    "unpointed",
    scripts,
    agents.replace(
      bullet,
      bullet.replaceAll("scripts/gates.mjs", "the script"),
    ),
  );
  assert.notEqual(result.status, 0, "a missing pointer must fail");
  assert.match(result.stderr, /must point at scripts\/gates\.mjs/);

  result = await run("clean", scripts);
  assert.equal(result.status, 0, result.stderr);
} finally {
  await rm(directory, { recursive: true, force: true });
}

// Pin the rule itself, so narrowing it cannot quietly shrink what the cases below cover.
for (const name of ["typecheck", "lint", "format:check", "test", "test:any"]) {
  assert.equal(isGateScript(name), true, `${name} must be a gate`);
}
for (const name of ["build", "fix", "check", "storybook", "format"]) {
  assert.equal(isGateScript(name), false, `${name} is not a gate script`);
}

// In-process cases on synthetic scripts, so they hold whatever the repo's own are.
const gateScripts = Object.fromEntries(gates.map((gate) => [gate, "true"]));
const none = [];
assert.deepEqual(
  findGateDrift({ gates, scripts: gateScripts, exempt: none }),
  [],
);
const withExample = { ...gateScripts, "test:example": "true" };
assert.equal(
  findGateDrift({ gates, scripts: withExample, exempt: none }).length,
  1,
);
assert.deepEqual(
  findGateDrift({ gates, scripts: withExample, exempt: ["test:example"] }),
  [],
  "an exempt script stays out of the gate list",
);
assert.deepEqual(
  findGateDrift({
    gates: [...gates, "lint"],
    scripts: gateScripts,
    exempt: none,
  }),
  ['"lint" appears in the gate list more than once'],
);
for (const name of gates.filter(isGateScript)) {
  const withoutGate = gates.filter((gate) => gate !== name);
  assert.equal(
    findGateDrift({ gates: withoutGate, scripts: gateScripts, exempt: none })
      .length,
    1,
    `dropping ${name} from the gate list is caught`,
  );
}
for (const name of ["build", "fix", "check", "storybook", "build:docs"]) {
  assert.deepEqual(
    findGateDrift({
      gates,
      scripts: { ...gateScripts, [name]: "true" },
      exempt: none,
    }),
    [],
    `${name} is not a verifying script`,
  );
}

// The AGENTS.md rule on synthetic bullets: every named gate form is caught, prose is not.
const bulletWith = (text) => `- \`pnpm check\`: ${text}\n`;
const pointer = "See scripts/gates.mjs.";
assert.deepEqual(
  findAgentsDrift({ agents: bulletWith(`static checks. ${pointer}`), gates }),
  [],
);
for (const name of gates.filter(isNamedGate)) {
  assert.equal(
    findAgentsDrift({
      agents: bulletWith(`runs ${name}, then more. ${pointer}`),
      gates,
    }).length,
    1,
    `naming ${name} in AGENTS.md is caught`,
  );
}
assert.deepEqual(
  findAgentsDrift({
    agents: bulletWith(`typecheck, lint, test and Storybook build. ${pointer}`),
    gates,
  }),
  [],
  "bare English words stay allowed",
);
assert.equal(
  findAgentsDrift({ agents: bulletWith("static checks."), gates }).length,
  1,
  "dropping the pointer is caught",
);
assert.equal(
  findAgentsDrift({ agents: "no bullet here", gates }).length,
  1,
  "a missing bullet is caught",
);
console.log("gate-list regression cases passed");
