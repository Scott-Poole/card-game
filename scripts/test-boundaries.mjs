import { ESLint } from "eslint";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

// Exercise the public lint gate on real files so typed parser settings also apply.
const eslint = new ESLint();
const cases = [
  [
    "engine",
    '// eslint-disable-next-line no-restricted-imports\nimport "node:fs";',
    "no-restricted-imports",
  ],
  ["engine", 'import "../../server/index.ts";', "no-restricted-imports"],
  ["engine", 'await import("../../server/index.ts");', "no-restricted-syntax"],
  [
    "engine",
    'export type T = typeof import("../../client/index.ts");',
    "no-restricted-syntax",
  ],
  ["engine", 'import "node:fs";', "no-restricted-imports"],
  ["engine", 'import "vitest";', "no-restricted-imports"],
  ["protocol", 'import "../../engine/index.ts";', "no-restricted-imports"],
  ["client", 'import "../../server/index.ts";', "no-restricted-imports"],
  ["server", 'import "../../client/index.ts";', "no-restricted-imports"],
];
for (const [area, source, rule] of cases) {
  const directory = await mkdtemp(join("src", area, "boundary-regression-"));
  try {
    const file = join(directory, "case.ts");
    await writeFile(file, source);
    const results = await eslint.lintFiles([file]);
    if (
      !results.some((result) =>
        result.messages.some((message) => message.ruleId === rule),
      )
    ) {
      throw new Error(`${area}: gate missed ${source}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
console.log(`${cases.length} boundary regression cases passed`);
