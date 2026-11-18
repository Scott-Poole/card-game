import { spawnSync } from "node:child_process";

const result = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const forbidden = result.stdout
  .split("\0")
  .filter(
    (path) =>
      /(^|\/)(?:\.scratch|\.out-of-scope)\//.test(path) ||
      /(^|\/)to-questionnaire-[^/]*\.md$/.test(path),
  );
if (forbidden.length) {
  console.error(
    "Working markdown must move to GitHub and leave the index:\n" +
      forbidden.join("\n"),
  );
  process.exit(1);
}
