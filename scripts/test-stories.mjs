// Opens every story in the built Storybook (`pnpm build-storybook` first) in Chromium and
// fails when one does not render: an uncaught page error, a console error, Storybook's
// error screen, or nothing visible on the page. Stories come from storybook-static/index.json,
// so a story added later is covered without touching this file.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { URL, fileURLToPath } from "node:url";

const root = resolve(
  fileURLToPath(new URL("../storybook-static", import.meta.url)),
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

async function serve() {
  const server = createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url ?? "/", "http://localhost");
      const file = normalize(join(root, decodeURIComponent(pathname)));
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": types[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("static server has no port");
  }
  return { server, origin: `http://127.0.0.1:${String(address.port)}` };
}

// Runs in the page. The InspectionSheet stories render into a portal outside
// #storybook-root, so look anywhere in the body, skipping Storybook's own chrome. An empty
// decorator wrapper has a size but shows nothing, so a visible element must carry its own
// text or be a replaced/interactive element.
function hasVisibleContent() {
  // Browser globals, read off globalThis since this file lints as Node.
  const { document, getComputedStyle, Node } = globalThis;
  const chrome = ".sb-wrapper, #storybook-docs, script, style";
  const shown =
    "img, svg, canvas, video, button, input, select, textarea, [role]";
  return [...document.body.querySelectorAll("*")].some((element) => {
    if (element.id === "storybook-root" || element.closest(chrome))
      return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (
      box.width === 0 ||
      box.height === 0 ||
      style.visibility === "hidden" ||
      style.display === "none"
    ) {
      return false;
    }
    const ownText = [...element.childNodes].some(
      (node) =>
        node.nodeType === Node.TEXT_NODE &&
        (node.textContent ?? "").trim() !== "",
    );
    return ownText || element.matches(shown);
  });
}

async function checkStory(browser, origin, id) {
  const problems = [];
  const page = await browser.newPage();
  page.on("pageerror", (error) =>
    problems.push(`page error: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console.error: ${message.text()}`);
    }
  });
  try {
    await page.goto(
      `${origin}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`,
    );
    const state = await page.waitForFunction(
      () => {
        const { document } = globalThis;
        const classes = document.body.classList;
        if (classes.contains("sb-show-errordisplay")) return "error";
        if (classes.contains("sb-show-main")) return "rendered";
        return false;
      },
      undefined,
      { timeout: 15_000 },
    );
    if ((await state.jsonValue()) === "error") {
      const detail = await page
        .locator("#error-message")
        .innerText()
        .catch(() => "");
      problems.push(`Storybook error screen: ${detail.trim()}`);
    } else {
      await page.waitForLoadState("networkidle");
      if (!(await page.evaluate(hasVisibleContent))) {
        problems.push("nothing visible rendered");
      }
    }
  } catch (error) {
    problems.push(
      `did not finish rendering: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await page.close();
  }
  return problems;
}

const index = JSON.parse(await readFile(join(root, "index.json"), "utf8"));
const ids = Object.values(index.entries)
  .filter((entry) => entry.type === "story")
  .map((entry) => entry.id);
if (ids.length === 0) {
  console.error("test:stories: index.json lists no stories");
  process.exit(1);
}

const { server, origin } = await serve();
const browser = await chromium.launch();
const failures = [];
try {
  for (const id of ids) {
    const problems = await checkStory(browser, origin, id);
    if (problems.length > 0) failures.push({ id, problems });
  }
} finally {
  await browser.close();
  server.close();
}

for (const { id, problems } of failures) {
  console.error(`FAIL ${id}`);
  for (const problem of problems) console.error(`  ${problem}`);
}
if (failures.length > 0) {
  console.error(
    `test:stories: ${String(failures.length)} of ${String(ids.length)} stories failed to render`,
  );
  process.exit(1);
}
console.log(
  `test:stories: checked ${String(ids.length)} stories, all rendered`,
);
