import { readdir, readFile, access } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const lock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
const files = [join(root, "AGENTS.md")];
async function markdown(directory, recursive) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (recursive && entry.isDirectory()) await markdown(path, true);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
}
const skills = join(root, ".agents/skills");
for (const entry of await readdir(skills, { withFileTypes: true })) {
  if (entry.isDirectory() && !Object.hasOwn(lock.skills, entry.name)) {
    await markdown(join(skills, entry.name), true);
  }
}
await markdown(join(root, "docs/agents"), false);
let broken = 0;
for (const file of files.sort()) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    const path = target.split(/[?#]/, 1)[0];
    if (!path) continue;
    try {
      await access(resolve(dirname(file), path));
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      const line = source.slice(0, match.index).split("\n").length;
      console.error(`${relative(root, file)}:${line} -> ${target}`);
      broken++;
    }
  }
}
if (broken) process.exitCode = 1;
else console.log(`skill links passed (${files.length} Markdown files)`);
