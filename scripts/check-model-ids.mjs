import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const root = process.argv[2] ?? process.cwd();
const files = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
).split("\0");
const pattern =
  /\b(?:gpt-[\w.-]+|claude-(?!handoff\b|with-access\b|code\b)[\w.-]+|deepseek[\w./-]*|opencode\/[\w./-]+|(?:Opus|Sonnet|Haiku)\s+\d[\d.]*)/i;
const problems = [...new Set(files)]
  .filter(
    (file) =>
      file &&
      /(?:\.md$|\.agents\/skills\/)/.test(file) &&
      /\.(?:md|json)$/.test(file) &&
      file !== ".agents/skills/delegate/routing.json",
  )
  .flatMap((file) =>
    readFileSync(`${root}/${file}`, "utf8")
      .split("\n")
      .flatMap((line, i) =>
        pattern.test(line)
          ? [`${file}:${i + 1}: model id belongs in routing.json`]
          : [],
      ),
  );
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
