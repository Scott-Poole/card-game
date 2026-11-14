import { test as base, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const test = base.extend<{ address: string }>({
  address: async ({ browserName }, use) => {
    // Keep the browser fixture dependent on a built-in Playwright fixture.
    expect(browserName).toBe("chromium");
    const server = spawn(process.execPath, ["src/server/main.ts"], {
      env: { ...process.env, PORT: "0", CLIENT_DIRECTORY: "dist" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stopped = new Promise<void>((resolve) => {
      server.once("exit", () => {
        resolve();
      });
    });
    let diagnostics = "";
    server.stderr.on("data", (chunk: Buffer) => {
      diagnostics += chunk.toString();
    });
    const lines = createInterface({ input: server.stdout });
    try {
      const address = await new Promise<string>((resolve, reject) => {
        server.once("error", reject);
        server.once("exit", () => {
          reject(new Error(`Server exited before listening: ${diagnostics}`));
        });
        lines.on("line", (line: string) => {
          const match = /^Listening on port (\d+)$/.exec(line);
          if (match?.[1]) resolve(`http://localhost:${match[1]}`);
        });
      });
      await use(address);
    } finally {
      lines.close();
      server.kill("SIGTERM");
      await stopped;
    }
  },
});
test("production page connects and reconnects after reload", async ({
  page,
  address,
}) => {
  await page.goto(address);
  await expect(page.getByRole("status")).toHaveText("connected");
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("connected");
});
test("stays connecting until a welcome arrives", async ({ page, address }) => {
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage(() => {
      /* The server intentionally withholds its welcome. */
    });
  });
  await page.goto(address);
  // Allow the intercepted socket open event to run before checking initial state.
  await page.waitForTimeout(100);
  await expect(page.getByRole("status")).toHaveText("connecting");
});
for (const message of [
  "not JSON",
  '{"type":"error","error":"invalid-message"}',
]) {
  test(`server message ${message} displays error`, async ({
    page,
    address,
  }) => {
    await page.routeWebSocket("**/ws", (socket) => {
      socket.send(message);
    });
    await page.goto(address);
    await expect(page.getByRole("status")).toHaveText("error");
  });
}
test("socket closure displays error", async ({ page, address }) => {
  await page.routeWebSocket("**/ws", (socket) => {
    void socket.close();
  });
  await page.goto(address);
  await expect(page.getByRole("status")).toHaveText("error");
});

test("two players finish six turns with consistent results", async ({
  browser,
  address,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const pages = [await first.newPage(), await second.newPage()];
    for (const page of pages) {
      await page.goto(address);
      await page
        .getByRole("button", { name: "Find match", exact: true })
        .click();
    }
    for (let turn = 1; turn <= 6; turn++) {
      for (const page of pages) {
        await expect(
          page.getByRole("heading", { name: `Turn ${String(turn)} of 6` }),
        ).toBeVisible();
        const playable = page
          .getByRole("button", { name: /Stage .* in lane/ })
          .and(page.locator(":enabled"));
        if (await playable.count()) {
          await playable.first().click();
          await expect(
            page.getByRole("button", { name: /Unstage/ }),
          ).toHaveCount(1);
        }
        await page.getByRole("button", { name: "Commit", exact: true }).click();
      }
    }
    for (const page of pages)
      await expect(
        page.getByRole("heading", { name: "Match result" }),
      ).toBeVisible();
    const outcomes = await Promise.all(
      pages.map((page) => page.getByLabel("Winner").innerText()),
    );
    expect(outcomes.sort()).toEqual(
      outcomes[0] === "Draw" ? ["Draw", "Draw"] : ["You lose", "You win"],
    );
  } finally {
    await first.close();
    await second.close();
  }
});

test("staging is reversible, private, and locked after commit; disconnect forfeits", async ({
  browser,
  address,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    for (const page of [a, b]) {
      await page.goto(address);
      await page
        .getByRole("button", { name: "Find match", exact: true })
        .click();
    }
    await expect(a.getByRole("heading", { name: "Turn 1 of 6" })).toBeVisible();
    const unaffordable = a
      .getByRole("region", { name: "Hand" })
      .getByRole("article")
      .filter({ hasText: /Cost [2-6]/ });
    await expect(
      unaffordable.first().getByRole("button").first(),
    ).toBeDisabled();
    // Advance empty turns if the shuffled opening hand has no affordable card.
    for (let turn = 1; turn <= 6; turn++) {
      await expect(
        a.getByRole("heading", { name: `Turn ${String(turn)} of 6` }),
      ).toBeVisible();
      const buttons = a
        .getByRole("region", { name: "Hand" })
        .getByRole("button");
      const enabled = buttons.and(a.locator(":enabled"));
      if (await enabled.count()) break;
      await a.getByRole("button", { name: "Commit", exact: true }).click();
      await b.getByRole("button", { name: "Commit", exact: true }).click();
    }
    const hand = a.getByRole("region", { name: "Hand" });
    const stage = hand.getByRole("button").and(a.locator(":enabled")).first();
    const label = await stage.innerText();
    await stage.click();
    const unstage = a.getByRole("button", { name: /Unstage/ });
    await expect(unstage).toBeEnabled();
    await expect(
      b
        .getByRole("region", { name: "Staged cards" })
        .getByRole("listitem")
        .filter({ hasText: /^Player / }),
    ).toHaveCount(0);
    await expect(
      b
        .getByRole("region", { name: "Previous reveal" })
        .getByRole("listitem")
        .filter({ hasText: /^Player / }),
    ).toHaveCount(0);
    for (let lane = 1; lane <= 3; lane++)
      await expect(
        b
          .getByRole("region", { name: `Lane ${String(lane)}`, exact: true })
          .getByRole("listitem"),
      ).toHaveCount(0);
    await unstage.click();
    await expect(
      hand.getByRole("button", { name: label, exact: true }),
    ).toBeEnabled();
    await hand.getByRole("button", { name: label, exact: true }).click();
    await expect(unstage).toBeEnabled();
    await a.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(unstage).toBeDisabled();
    await expect(
      b.getByText("Opponent has committed", { exact: true }),
    ).toBeVisible();
    await second.close();
    await expect(
      a.getByRole("heading", { name: "Match result" }),
    ).toBeVisible();
    await expect(a.getByLabel("Winner")).toHaveText("You win");
    await expect(a.getByText("Forfeit: opponent left the match")).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});
