import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { roster } from "./roster.ts";

export type ArtIssue =
  | {
      readonly code: "unrecorded-file";
      readonly index: -1;
      readonly file: string;
    }
  | ArtEntryIssue;

interface ArtEntryIssue {
  readonly code:
    | "manifest"
    | "entry"
    | "cardId"
    | "duplicate-cardId"
    | "license"
    | "sourceUrl"
    | "licenseUrl"
    | "attribution"
    | "retrievedOn"
    | "file"
    | "missing-file"
    | "non-regular-file"
    | "file-read"
    | "oversize-file"
    | "sha256"
    | "title"
    | "author"
    | "modifications";
  readonly index: number;
}

/** Validates untrusted JSON and local bytes; does not require full roster coverage. */
export async function validateArtManifest(
  manifest: unknown,
  directory: string,
): Promise<readonly ArtIssue[]> {
  if (!Array.isArray(manifest)) return [{ code: "manifest", index: -1 }];
  const issues: ArtIssue[] = [];
  const seen = new Set<string>();
  const files = new Set<string>();
  for (const [index, value] of manifest.entries()) {
    const entry: unknown = value;
    const add = (code: ArtEntryIssue["code"]) => {
      issues.push({ code, index });
    };
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      add("entry");
      continue;
    }
    if (
      !("cardId" in entry) ||
      typeof entry.cardId !== "string" ||
      !roster.some(({ card }) => card.id === entry.cardId)
    )
      add("cardId");
    if ("cardId" in entry && typeof entry.cardId === "string") {
      if (seen.has(entry.cardId)) add("duplicate-cardId");
      seen.add(entry.cardId);
    }
    for (const field of ["title", "author", "modifications"] as const) {
      const text: unknown = Reflect.get(entry, field);
      if (
        typeof text !== "string" ||
        (field !== "modifications" && !text.trim())
      )
        add(field);
    }
    for (const field of ["sourceUrl", "licenseUrl"] as const) {
      const url: unknown = Reflect.get(entry, field);
      try {
        if (typeof url !== "string" || new URL(url).protocol !== "https:")
          add(field);
      } catch {
        add(field);
      }
    }
    const license = "license" in entry ? entry.license : undefined;
    if (
      typeof license !== "string" ||
      ![
        "PDM-1.0",
        "CC0-1.0",
        "CC-BY-3.0",
        "CC-BY-4.0",
        "CC-BY-SA-3.0",
        "CC-BY-SA-4.0",
      ].includes(license)
    )
      add("license");
    if (
      !("attribution" in entry) ||
      typeof entry.attribution !== "string" ||
      (typeof license === "string" &&
        license.startsWith("CC-BY") &&
        !entry.attribution.trim())
    )
      add("attribution");
    const date = "retrievedOn" in entry ? entry.retrievedOn : undefined;
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      add("retrievedOn");
    const digest = "sha256" in entry ? entry.sha256 : undefined;
    if (typeof digest !== "string" || !/^[a-fA-F0-9]{64}$/.test(digest))
      add("sha256");
    if (
      !("file" in entry) ||
      typeof entry.file !== "string" ||
      !/^[^/\\]+\.(webp|jpg|png)$/.test(entry.file)
    ) {
      add("file");
      continue;
    }
    files.add(entry.file);
    try {
      const path = join(directory, entry.file);
      const stat = await lstat(path);
      if (!stat.isFile()) {
        add("non-regular-file");
        continue;
      }
      if (stat.size > 400_000) {
        add("oversize-file");
        continue;
      }
      const bytes = await readFile(path);
      if (bytes.length > 400_000) add("oversize-file");
      if (
        typeof digest === "string" &&
        /^[a-fA-F0-9]{64}$/.test(digest) &&
        createHash("sha256").update(bytes).digest("hex") !==
          digest.toLowerCase()
      )
        add("sha256");
    } catch (error) {
      add(
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? "missing-file"
          : "file-read",
      );
    }
  }
  for (const file of await readdir(directory)) {
    if (/\.(webp|jpg|png)$/i.test(file) && !files.has(file))
      issues.push({ code: "unrecorded-file", index: -1, file });
  }
  return issues;
}
