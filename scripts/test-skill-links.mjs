import { readdir, readFile, access } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    return false;
  }
}
const root = resolve(process.argv[2] ?? ".");
const lock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
const files = [join(root, "AGENTS.md")];
async function markdown(directory, recursive) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
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
await markdown(join(root, "docs/adr"), false);
if (await exists(join(root, "GLOSSARY.md")))
  files.push(join(root, "GLOSSARY.md"));
const repoRoots = ["src/", "docs/", "scripts/", "e2e/", ".agents/", ".claude/"];
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
  // Backticked repo paths: whole tokens under a repo root, fenced blocks included.
  for (const match of source.matchAll(/`([^`\s]+)`/g)) {
    const token = match[1];
    if (!repoRoots.some((prefix) => token.startsWith(prefix))) continue;
    if (/[*<{]/.test(token)) continue;
    if (await exists(resolve(root, token))) continue;
    const line = source.slice(0, match.index).split("\n").length;
    console.error(`${relative(root, file)}:${line} -> ${token}`);
    broken++;
  }
}
if (broken) process.exitCode = 1;
else console.log(`skill links passed (${files.length} Markdown files)`);
