import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { exemptScripts, findGateDrift, gates } from "./gates.mjs";

const { scripts } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

// The real tree: every verifying script is a gate and every gate is a script.
const drift = findGateDrift({ gates, scripts, exempt: exemptScripts });
assert.deepEqual(drift, [], drift.join("\n"));

// Fixtures: the suite must catch each way the two can drift.
const fixtureScripts = { ...scripts, "test:example": "node example.mjs" };
assert.deepEqual(
  findGateDrift({ gates, scripts: fixtureScripts, exempt: [] }),
  [
    '"test:example" is a package.json script missing from the gate list in scripts/gates.mjs (add it, or exempt it with a reason in exemptScripts)',
  ],
);
assert.deepEqual(
  findGateDrift({ gates, scripts: fixtureScripts, exempt: ["test:example"] }),
  [],
  "an exempt script stays out of the gate list",
);
assert.deepEqual(
  findGateDrift({
    gates: [...gates, "test:ghost"],
    scripts,
    exempt: [],
  }),
  ['"test:ghost" is in the gate list but package.json has no such script'],
);
assert.deepEqual(
  findGateDrift({ gates: [...gates, "lint"], scripts, exempt: [] }),
  ['"lint" appears in the gate list more than once'],
);
for (const name of ["typecheck", "lint", "format:check", "test"]) {
  const withoutGate = gates.filter((gate) => gate !== name);
  assert.equal(
    findGateDrift({ gates: withoutGate, scripts, exempt: [] }).length,
    1,
    `dropping ${name} from the gate list is caught`,
  );
}
for (const name of ["build", "fix", "check", "storybook", "build-storybook"]) {
  assert.equal(
    findGateDrift({
      gates,
      scripts: { ...scripts, [name]: "true" },
      exempt: [],
    }).length,
    0,
    `${name} is not a verifying script`,
  );
}
console.log("gate-list regression cases passed");
