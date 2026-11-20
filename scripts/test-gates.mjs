import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { exemptScripts, findGateDrift, gates, isGateScript } from "./gates.mjs";

// With a path argument the suite checks that package.json against the real gate list
// and exits; without one it checks the repo's own, then proves the check bites.
const target = process.argv[2];
const packageJson = target
  ? pathToFileURL(resolve(target))
  : new URL("../package.json", import.meta.url);
const { scripts } = JSON.parse(await readFile(packageJson, "utf8"));
const drift = findGateDrift({ gates, scripts, exempt: exemptScripts });
assert.deepEqual(drift, [], drift.join("\n"));
if (target) process.exit(0);

// Fixture package.json files, run through this same script as a child process.
const self = fileURLToPath(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "gate-list-"));
async function run(name, fixtureScripts) {
  const file = join(directory, `${name}.json`);
  await writeFile(file, JSON.stringify({ scripts: fixtureScripts }));
  return spawnSync(process.execPath, [self, file], { encoding: "utf8" });
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

  result = await run("clean", scripts);
  assert.equal(result.status, 0, result.stderr);
} finally {
  await rm(directory, { recursive: true, force: true });
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
console.log("gate-list regression cases passed");
