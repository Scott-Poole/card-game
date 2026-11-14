import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { validateArtManifest } from "./art.ts";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "card-art-"));
  await writeFile(join(directory, "image.png"), "abc");
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const valid = {
  cardId: "hermes-letterkeeper",
  file: "image.png",
  sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  title: "Hermes",
  author: "Artist",
  sourceUrl: "https://example.com/art",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  license: "CC-BY-4.0",
  attribution: "Hermes by Artist, CC BY 4.0",
  retrievedOn: "2026-11-14",
  modifications: "",
};
test("accepts complete metadata and matching file bytes", async () => {
  expect(await validateArtManifest([valid], directory)).toEqual([]);
});

test.each([
  ["cardId", { cardId: "unknown" }],
  ["license", { license: "CC-BY-NC-4.0" }],
  ["sourceUrl", { sourceUrl: "http://example.com" }],
  ["licenseUrl", { licenseUrl: "invalid" }],
  ["attribution", { attribution: " " }],
  ["retrievedOn", { retrievedOn: "2026-02-30" }],
  ["retrievedOn", { retrievedOn: "not-a-date" }],
  ["missing-file", { file: "missing.jpg" }],
  ["file", { file: "image.svg" }],
  ["file", { file: "../image.png" }],
  ["sha256", { sha256: "0".repeat(64) }],
  ["sha256", { sha256: "bad" }],
  ["title", { title: " " }],
  ["author", { author: "" }],
  ["modifications", { modifications: null }],
])(
  "reports %s for incomplete or invalid metadata (%j)",
  async (code, patch) => {
    expect(
      await validateArtManifest([{ ...valid, ...patch }], directory),
    ).toEqual([{ code, index: 0 }]);
  },
);

test("rejects duplicate card art", async () => {
  expect(await validateArtManifest([valid, valid], directory)).toEqual([
    { code: "duplicate-cardId", index: 1 },
  ]);
});

test.each([400_000, 400_001])(
  "enforces the 400 KB byte limit (%i)",
  async (size) => {
    await writeFile(join(directory, "image.png"), Buffer.alloc(size));
    const issues = await validateArtManifest([valid], directory);
    expect(issues).toEqual(
      size === 400_000
        ? [{ code: "sha256", index: 0 }]
        : [
            { code: "oversize-file", index: 0 },
            { code: "sha256", index: 0 },
          ],
    );
  },
);

test.each([
  "PDM-1.0",
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "CC-BY-SA-3.0",
  "CC-BY-SA-4.0",
])("accepts allowed license %s", async (license) => {
  expect(
    await validateArtManifest(
      [
        {
          ...valid,
          license,
          attribution: license.startsWith("CC-BY") ? valid.attribution : "",
        },
      ],
      directory,
    ),
  ).toEqual([]);
});

test("reports malformed JSON shapes without throwing", async () => {
  expect(await validateArtManifest({}, directory)).toEqual([
    { code: "manifest", index: -1 },
  ]);
  expect(await validateArtManifest([null], directory)).toEqual([
    { code: "entry", index: 0 },
  ]);
});

test("shipped manifest has no issues", async () => {
  const directory = new URL("../../content/art/", import.meta.url);
  const manifest: unknown = JSON.parse(
    await readFile(new URL("manifest.json", directory), "utf8"),
  );
  expect(await validateArtManifest(manifest, fileURLToPath(directory))).toEqual(
    [],
  );
});
