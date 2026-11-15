import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { roster } from "./roster.ts";
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
  cardName: "Hermes, Keeper of Unsent Letters",
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

test("rejects a cardName that differs from its roster card", async () => {
  expect(
    await validateArtManifest(
      [{ ...valid, cardName: "Wrong name" }],
      directory,
    ),
  ).toEqual([{ code: "cardName", index: 0 }]);
});

test.each([undefined, 42, "", " "])(
  "rejects missing or invalid cardName %j",
  async (cardName) => {
    const withoutName = { ...valid };
    Reflect.deleteProperty(withoutName, "cardName");
    const entry = cardName === undefined ? withoutName : { ...valid, cardName };
    expect(await validateArtManifest([entry], directory)).toEqual([
      { code: "cardName", index: 0 },
    ]);
  },
);

test("reports only cardId when an unknown card also has no cardName", async () => {
  const withoutName = { ...valid };
  Reflect.deleteProperty(withoutName, "cardName");
  expect(
    await validateArtManifest(
      [{ ...withoutName, cardId: "unknown" }],
      directory,
    ),
  ).toEqual([{ code: "cardId", index: 0 }]);
});

test.each([
  ["cardId", { cardId: "unknown" }],
  ["license", { license: "CC-BY-NC-4.0" }],
  ["sourceUrl", { sourceUrl: "http://example.com" }],
  ["licenseUrl", { licenseUrl: "invalid" }],
  ["attribution", { attribution: " " }],
  ["attribution", { attribution: undefined }],
  ["attribution", { attribution: null, license: "CC-BY-SA-4.0" }],
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
      (await validateArtManifest([{ ...valid, ...patch }], directory)).filter(
        (issue) => issue.code !== "unrecorded-file",
      ),
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
    const sha256 = createHash("sha256")
      .update(Buffer.alloc(size))
      .digest("hex");
    const issues = await validateArtManifest([{ ...valid, sha256 }], directory);
    expect(issues).toEqual(
      size === 400_000 ? [] : [{ code: "oversize-file", index: 0 }],
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
  expect(
    (await validateArtManifest([null], directory)).filter(
      (issue) => issue.code !== "unrecorded-file",
    ),
  ).toEqual([{ code: "entry", index: 0 }]);
});

test("shipped manifest covers every roster card exactly once", async () => {
  const manifest: unknown = JSON.parse(
    await readFile(
      new URL("../../content/art/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  expect(Array.isArray(manifest)).toBe(true);
  if (!Array.isArray(manifest)) return;
  const ids = manifest.map((entry: unknown) =>
    typeof entry === "object" && entry !== null && "cardId" in entry
      ? entry.cardId
      : undefined,
  );
  expect(ids.sort()).toEqual(roster.map(({ card }) => card.id).sort());
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

test("rejects art files without a manifest record", async () => {
  expect(await validateArtManifest([], directory)).toEqual([
    { code: "unrecorded-file", index: -1, file: "image.png" },
  ]);
});

test("rejects symlinks instead of reading outside the art directory", async () => {
  await symlink("image.png", join(directory, "link.png"));
  expect(
    await validateArtManifest(
      [
        { ...valid, file: "link.png" },
        {
          ...valid,
          cardId: "janus-dawnhinge",
          cardName: "Janus, Hinge of Morning",
        },
      ],
      directory,
    ),
  ).toEqual([{ code: "non-regular-file", index: 0 }]);
});

test.each(["extra.jpeg", "nested"])(
  "rejects every unrecorded directory entry: %s",
  async (file) => {
    if (file === "nested") {
      await mkdir(join(directory, file));
      await writeFile(join(directory, file, "extra.png"), "abc");
    } else await writeFile(join(directory, file), "abc");
    expect(await validateArtManifest([valid], directory)).toEqual([
      { code: "unrecorded-file", index: -1, file },
    ]);
  },
);
