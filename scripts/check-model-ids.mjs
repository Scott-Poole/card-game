import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
const root = process.argv[2] ?? process.cwd();
const files = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
).split("\0");
const pattern =
  /\b(?:gpt-[\w.-]+|claude-(?!with-access\b|code\b)[\w.-]+|deepseek[\w./-]*|opencode\/[\w./-]+|(?:Opus|Sonnet|Haiku)\s+\d[\d.]*)/i;
const problems = [...new Set(files)]
  .filter(
    (file) =>
      file &&
      /(?:\.md$|^docs\/|^\.agents\/skills\/)/.test(file) &&
      existsSync(`${root}/${file}`) &&
      statSync(`${root}/${file}`).isFile() &&
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
