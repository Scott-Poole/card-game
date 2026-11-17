import type { Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const test = base.extend<{ address: string; pair: readonly [Page, Page] }>({
  pair: async ({ browser, address }, use) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    try {
      const pages = [await first.newPage(), await second.newPage()] satisfies [
        Page,
        Page,
      ];
      for (const page of pages) {
        await page.goto(address);
        await page
          .getByRole("button", { name: "Find match", exact: true })
          .click();
      }
      for (const page of pages)
        await expect(
          page.getByRole("heading", { name: "Turn 1 of 6" }),
        ).toBeVisible();
      await use(pages);
    } finally {
      await first.close();
      await second.close();
    }
  },
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
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(21, 23, 25)",
  );
  await page.keyboard.press("Tab");
  const join = page.getByRole("button", { name: "Find match", exact: true });
  await expect(join).toBeFocused();
  await expect(join).toHaveCSS("outline-offset", "2px");

  await page.reload();
  await expect(page.getByRole("status")).toHaveText("connected");
});
test("stays connecting until a welcome arrives", async ({ page, address }) => {
  const opened = Promise.withResolvers<undefined>();
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage(() => {
      /* The server intentionally withholds its welcome. */
    });
    opened.resolve(undefined);
  });
  await page.addInitScript(() => {
    globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
      construct(Target, args: ConstructorParameters<typeof WebSocket>) {
        const socket = new Target(...args);
        socket.addEventListener("open", () => {
          performance.mark("test:socket-open");
        });
        return socket;
      },
    });
  });
  await page.goto(address);
  await opened.promise;
  await expect
    .poll(() =>
      page.evaluate(
        () => performance.getEntriesByName("test:socket-open").length,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("status")).toHaveText("connecting");
});
for (const message of [
  "not JSON",
  '{"type":"state","view":{}}',
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
  test.setTimeout(30_000);
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
    const stagedPlayers = new Set<Page>();
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
          stagedPlayers.add(page);
          await expect(
            page.getByRole("button", { name: /Unstage/ }),
          ).toHaveCount(1);
        }
        await page.getByRole("button", { name: "Commit", exact: true }).click();
      }
    }
    expect(stagedPlayers.size).toBe(2);
    for (const page of pages)
      await expect(
        page.getByRole("heading", { name: "Match result" }),
      ).toBeVisible();
    const outcomes = await Promise.all(
      pages.map((page) => page.getByLabel("Winner").innerText()),
    );
    const results = await Promise.all(
      pages.map((page) =>
        page
          .getByRole("region", { name: "Match result" })
          .getByRole("listitem")
          .allTextContents(),
      ),
    );
    expect(
      results[0]?.map((text) =>
        text
          .replace("You win", "Opponent wins")
          .replace("You lose", "You win")
          .replace("Opponent wins", "You lose"),
      ),
    ).toEqual(results[1]);
    const power = await Promise.all(
      pages.map((page) =>
        page
          .getByRole("region", { name: "Match result" })
          .getByText(/^Total power:/)
          .innerText(),
      ),
    );
    expect(power[0]).toBe(power[1]);
    expect(outcomes.sort()).toEqual(
      outcomes[0] === "Draw" ? ["Draw", "Draw"] : ["You lose", "You win"],
    );
  } finally {
    await first.close();
    await second.close();
  }
});

async function reachPlayableTurn(a: Page, b: Page) {
  // Real shuffled decks can lack an affordable opening card. Empty commits are legal.
  for (let turn = 1; turn <= 6; turn++) {
    for (const page of [a, b])
      await expect(
        page.getByRole("heading", { name: `Turn ${String(turn)} of 6` }),
      ).toBeVisible();
    const enabled = a
      .getByRole("region", { name: "Hand" })
      .getByRole("button", { name: /Stage .* in lane/ })
      .and(a.locator(":enabled"));
    if (await enabled.count()) return enabled.first();
    await a.getByRole("button", { name: "Commit", exact: true }).click();
    await b.getByRole("button", { name: "Commit", exact: true }).click();
  }
  throw new Error("No playable card in six turns");
}

test("staging prevents overspend, returns unstaged cards, and locks after commit", async ({
  pair: [a, b],
}) => {
  const hand = a.getByRole("region", { name: "Hand" });
  const unaffordable = hand
    .getByRole("article")
    .filter({ hasText: /Cost [2-6]/ });
  await expect(
    unaffordable
      .first()
      .getByRole("button", { name: /Stage .* in lane/ })
      .first(),
  ).toBeDisabled();
  const stage = await reachPlayableTurn(a, b);
  const label = await stage.getAttribute("aria-label");
  if (!label) throw new Error("Missing stage action name");
  await stage.click();
  const unstage = a.getByRole("button", { name: /Unstage/ });
  await expect(unstage).toBeEnabled();
  await unstage.click();
  await expect(
    hand.getByRole("button", { name: label, exact: true }),
  ).toBeEnabled();
  await hand.getByRole("button", { name: label, exact: true }).click();
  await expect(unstage).toBeEnabled();
  await a.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(unstage).toBeDisabled();
  const committedBounds = await a
    .getByText("You have committed", { exact: true })
    .boundingBox();
  const laneBounds = await a
    .getByRole("region", { name: "Lane 1", exact: true })
    .boundingBox();
  if (!committedBounds || !laneBounds)
    throw new Error("Missing committed board");
  expect(committedBounds.y + committedBounds.height).toBeLessThanOrEqual(
    laneBounds.y,
  );

  await expect(
    hand
      .getByRole("button", { name: /Stage .* in lane/ })
      .and(a.locator(":enabled")),
  ).toHaveCount(0);
  await expect(
    b.getByText("Opponent has committed", { exact: true }),
  ).toBeVisible();
});

test("opponent staged cards stay hidden until resolution", async ({
  pair: [a, b],
}) => {
  const stage = await reachPlayableTurn(a, b);
  const label = await stage.getAttribute("aria-label");
  if (!label) throw new Error("Missing stage action name");
  const name = label.replace(/^Stage /, "").replace(/ in lane \d+$/, "");
  // Both decks share names, so compare the whole rendered page to its baseline:
  // the opponent's own hand may already contain the same card definition.
  const before = await b.locator("body").innerText();
  await stage.click();
  await expect(
    a.getByRole("button", { name: `Unstage ${name}`, exact: true }),
  ).toBeEnabled();
  await expect(b.locator("body")).toHaveText(before, { useInnerText: true });
  await expect(
    b.getByRole("region", { name: "Staged cards" }).getByRole("listitem"),
  ).toHaveCount(0);
  await a.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(
    b.getByText("Opponent has committed", { exact: true }),
  ).toBeVisible();
  await expect(
    b.getByRole("region", { name: "Staged cards" }).getByRole("listitem"),
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
  await b.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(
    b.getByRole("region", { name: "Previous reveal" }),
  ).toContainText(name);
  await expect(
    b.getByRole("region", { name: "Lane 1", exact: true }),
  ).toContainText(name);
});

test("closing a context mid-match gives the opponent a forfeit win", async ({
  pair: [a, b],
}) => {
  await b.context().close();
  await expect(a.getByRole("heading", { name: "Match result" })).toBeVisible();
  await expect(a.getByLabel("Winner")).toHaveText("You win");
  await expect(a.getByText("Forfeit: opponent left the match")).toBeVisible();
});

test("opponent updates do not unlock an unacknowledged stage", async ({
  page,
  address,
}) => {
  const view = {
    player: 0,
    turn: 1,
    energy: 1,
    phase: "planning",
    result: null,
    own: {
      hand: [
        { id: "a", name: "Asteron", cost: 1, power: 2 },
        { id: "b", name: "Thaleia", cost: 1, power: 2 },
      ],
      staged: [],
      deckSize: 10,
      committed: false,
      lanes: [[], [], []],
    },
    opponent: {
      handSize: 3,
      deckSize: 9,
      committed: false,
      lanes: [[], [], []],
    },
    events: [],
  };
  let acknowledge: () => void = () => {
    throw new Error("Socket not opened");
  };
  await page.routeWebSocket("**/ws", (socket) => {
    acknowledge = () => {
      socket.send(
        JSON.stringify({
          type: "state",
          view: {
            ...view,
            own: { ...view.own, staged: [{ cardId: "a", lane: 0 }] },
          },
        }),
      );
    };
    socket.send(JSON.stringify({ type: "welcome" }));
    socket.onMessage((message) => {
      if (message === '{"type":"join"}')
        socket.send(JSON.stringify({ type: "state", view }));
      else
        socket.send(
          JSON.stringify({
            type: "state",
            view: { ...view, opponent: { ...view.opponent, committed: true } },
          }),
        );
    });
  });
  await page.goto(address);
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  await page
    .getByRole("button", { name: "Stage Asteron in lane 1", exact: true })
    .click();
  await expect(
    page.getByText("Opponent has committed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stage Thaleia in lane 1", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Commit", exact: true }),
  ).toBeDisabled();
  acknowledge();
  await expect(
    page.getByRole("button", { name: "Unstage Asteron", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Stage Thaleia in lane 1", exact: true }),
  ).toBeDisabled();
});

test("server rejection after welcome permits another action", async ({
  page,
  address,
}) => {
  await page.routeWebSocket("**/ws", (socket) => {
    let rejected = false;
    socket.send(JSON.stringify({ type: "welcome" }));
    socket.onMessage(() => {
      socket.send(
        JSON.stringify(
          rejected
            ? { type: "waiting" }
            : { type: "error", error: "invalid-message" },
        ),
      );
      rejected = true;
    });
  });
  await page.goto(address);
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Request rejected");
  await expect(page.getByRole("status")).toHaveText("connected");
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  await expect(page.getByText("Waiting for an opponent…")).toBeVisible();
});

test("socket closure clears the queue waiting indicator", async ({
  page,
  address,
}) => {
  let disconnect: () => void = () => {
    throw new Error("Socket route has not opened");
  };
  await page.routeWebSocket("**/ws", (socket) => {
    disconnect = () => {
      void socket.close();
    };
    socket.send('{"type":"welcome"}');
    socket.onMessage(() => {
      socket.send('{"type":"waiting"}');
    });
  });
  await page.goto(address);
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  await expect(
    page.getByText("Waiting for an opponent…", { exact: true }),
  ).toBeVisible();
  disconnect();
  await expect(page.getByRole("status")).toHaveText("error");
  await expect(
    page.getByText("Waiting for an opponent…", { exact: true }),
  ).not.toBeVisible();
});

test("undecodable server frame closes the client socket", async ({
  page,
  address,
}) => {
  let closed = false;
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onClose(() => {
      closed = true;
    });
    socket.send('{"type":"welcome"}');
    socket.send("garbage{");
  });
  await page.goto(address);
  await expect(page.getByRole("status")).toHaveText("error");
  await expect.poll(() => closed).toBe(true);
});

test("Play joins and moves to Waiting; a state message moves to Match and Result", async ({
  browser,
  page,
  address,
}) => {
  await page.goto(address);
  await expect(page.getByRole("status")).toHaveText("connected");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page).toHaveURL(address + "/waiting");
  await expect(page.getByText("Waiting for an opponent…")).toBeVisible();
  const opponent = await browser.newContext();
  try {
    const other = await opponent.newPage();
    await other.goto(address);
    await other
      .getByRole("button", { name: "Find match", exact: true })
      .click();
    await expect(page).toHaveURL(address + "/match");
    await opponent.close();
    await expect(page).toHaveURL(address + "/result");
    await expect(
      page.getByRole("heading", { name: "Match result", exact: true }),
    ).toBeVisible();
  } finally {
    await opponent.close();
  }
});

test("deep links follow session state without interrupting live actions", async ({
  pair: [a, b],
  address,
}) => {
  await expect(a).toHaveURL(address + "/match");
  await a.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(
    b.getByText("Opponent has committed", { exact: true }),
  ).toBeVisible();
  for (const path of [
    "/match",
    "/MATCH",
    "/waiting/",
    "/result/",
    "/%6datch",
    "/wait%69ng",
  ]) {
    await a.goto(address + path);
    await expect(a).toHaveURL(address + "/");
    await expect(
      a.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
  }
  await a.reload();
  await expect(a.getByRole("status")).toHaveText("connected");
  await a.goto(address + "/unknown");
  await expect(
    a.getByRole("heading", { name: "Page not found", exact: true }),
  ).toBeVisible();
  await a.getByRole("link", { name: "Home", exact: true }).click();
  await expect(a).toHaveURL(address + "/");
});

test("Play is disabled before welcome and after connection failure", async ({
  page,
  address,
}) => {
  let fail: () => void = () => {
    throw new Error("Socket has not opened");
  };
  await page.routeWebSocket("**/ws", (socket) => {
    fail = () => {
      void socket.close();
    };
  });
  await page.goto(address);
  await expect(page.getByRole("status")).toHaveText("connecting");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeDisabled();
  fail();
  await expect(page.getByRole("status")).toHaveText("error");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeDisabled();
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`portrait board fits ${String(viewport.width)}x${String(viewport.height)} and empty commit advances live energy`, async ({
    pair: [a, b],
  }) => {
    await a.setViewportSize(viewport);
    const board = a.getByRole("region", { name: "Match board", exact: true });
    await expect(board).toBeVisible();
    await expect
      .poll(async () => (await board.boundingBox())?.width)
      .toBeCloseTo(Math.min(viewport.width, viewport.height * 0.6), 1);
    const bounds = await board.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error("Board missing");
    expect(bounds.width / bounds.height).toBeCloseTo(0.6, 2);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await a.evaluate(
        "document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth",
      ),
    ).toBe(true);
    await expect(a.getByText("Energy: 1 of 1", { exact: true })).toBeVisible();
    const handBounds = await a
      .getByRole("region", { name: "Hand", exact: true })
      .boundingBox();
    const lastLane = await a
      .getByRole("region", { name: "Hand", exact: true })
      .getByRole("article")
      .first()
      .getByRole("button", { name: /in lane 3$/ })
      .boundingBox();
    if (!handBounds || !lastLane) throw new Error("Missing hand controls");
    expect(lastLane.y + lastLane.height).toBeLessThanOrEqual(
      handBounds.y + handBounds.height,
    );
    const lanes = a.getByRole("region", { name: "Lane 1", exact: true });
    const laneBeforeCommit = await lanes.boundingBox();
    await a.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(
      a.getByText("You have committed", { exact: true }),
    ).toBeVisible();
    expect(await lanes.boundingBox()).toEqual(laneBeforeCommit);
    const meta = await a.getByText(/^You are player/).boundingBox();
    const notice = await a
      .getByText("You have committed", { exact: true })
      .boundingBox();
    if (!meta || !notice) throw new Error("Missing match information");
    expect(meta.y + meta.height).toBeLessThanOrEqual(notice.y);
    await expect(
      a.getByRole("button", { name: "Commit", exact: true }),
    ).toBeDisabled();
    await b.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(a.getByRole("heading", { name: "Turn 2 of 6" })).toBeVisible();
    await expect(a.getByText("Energy: 2 of 2", { exact: true })).toBeVisible();
    await expect(a.getByText("Stakes", { exact: true })).toHaveCount(0);
    await expect(
      a.getByRole("button", { name: "Retreat", exact: true }),
    ).toBeDisabled();
  });
}

test("multiple staged cards can be returned from the portrait board", async ({
  pair: [a, b],
}) => {
  await a.setViewportSize({ width: 390, height: 844 });
  for (let turn = 1; turn < 6; turn++) {
    await a.getByRole("button", { name: "Commit", exact: true }).click();
    await b.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(
      a.getByRole("heading", { name: `Turn ${String(turn + 1)} of 6` }),
    ).toBeVisible();
  }
  for (let count = 0; count < 2; count++) {
    const hand = a.getByRole("region", { name: "Hand", exact: true });
    const cheap = hand.getByRole("article").filter({ hasText: /Cost [1-3]/ });
    const play = cheap
      .getByRole("button", { name: /in lane 1$/ })
      .and(a.locator(":enabled"))
      .first();
    await play.click();
    await expect(a.getByRole("button", { name: /Unstage/ })).toHaveCount(
      count + 1,
    );
  }
  const staged = a.getByRole("region", { name: "Staged cards", exact: true });
  await expect(staged.getByText("Lane 1", { exact: true })).toHaveCount(2);
  const bounds = await staged.boundingBox();
  const buttons = staged.getByRole("button");
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    if (!bounds || !box) throw new Error("Missing return controls");
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  await buttons.last().click();
  await expect(buttons).toHaveCount(1);
  await buttons.first().click();
  await expect(buttons).toHaveCount(0);
});

test("revealed lane cards and totals follow both players through every turn", async ({
  pair: [a, b],
}) => {
  test.setTimeout(30_000);
  await a.setViewportSize({ width: 390, height: 844 });
  await b.setViewportSize({ width: 1440, height: 900 });
  const records = new Map<
    Page,
    { name: string; power: number; lane: number }[]
  >([
    [a, []],
    [b, []],
  ]);
  for (let turn = 1; turn <= 6; turn++) {
    for (const page of [a, b]) {
      await expect(
        page.getByRole("heading", { name: `Turn ${String(turn)} of 6` }),
      ).toBeVisible();
      const choices = page
        .getByRole("button", { name: /Stage .* in lane/ })
        .and(page.locator(":enabled"));
      const preferred = choices.filter({
        hasText: `Lane ${String((turn % 3) + 1)}`,
      });
      const play = (await preferred.count())
        ? preferred.first()
        : choices.first();
      if (await play.count()) {
        const label = await play.getAttribute("aria-label");
        const match = /^Stage (.*) in lane (\d+)$/.exec(label ?? "");
        if (!match?.[1] || !match[2]) throw new Error("Missing play label");
        const name = match[1];
        const powerText = await page
          .getByRole("region", { name: "Hand", exact: true })
          .getByRole("article", { name, exact: true })
          .getByText(/^Power /)
          .innerText();
        const laneRegion = page.getByRole("region", {
          name: `Lane ${match[2]}`,
          exact: true,
        });
        const totalBefore = await laneRegion
          .getByText(/^Opponent total:/)
          .innerText();
        await play.click();
        await expect(
          page
            .getByRole("region", { name: `Lane ${match[2]}`, exact: true })
            .getByRole("group", { name: "Your cards" })
            .getByRole("article", { name, exact: true }),
        ).toBeVisible();
        await expect(laneRegion.getByText(/^Opponent total:/)).toHaveText(
          totalBefore,
        );
        const preview = laneRegion
          .getByRole("group", { name: "Your cards" })
          .getByRole("article", { name, exact: true });
        await expect(preview).toHaveAccessibleDescription(
          "Staged, not yet revealed",
        );
        await expect(async () => {
          const previewBox = await preview.boundingBox();
          const nameBox = await preview
            .getByText(name, { exact: true })
            .boundingBox();
          if (!previewBox || !nameBox) throw new Error("Missing preview text");
          const statBox = await preview.getByLabel(/^Power /).boundingBox();
          if (!statBox) throw new Error("Missing preview power");
          expect(nameBox.height).toBeLessThanOrEqual(statBox.height + 1);

          expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(
            previewBox.y + previewBox.height + 1,
          );
        }).toPass({ timeout: 1000 });
        records.get(page)?.push({
          name,
          power: Number(powerText.replace("Power ", "")),
          lane: Number(match[2]),
        });
      }
      await page.getByRole("button", { name: "Commit", exact: true }).click();
    }
    for (const page of [a, b]) {
      await expect(
        page.getByRole("heading", {
          name: turn === 6 ? "Match result" : `Turn ${String(turn + 1)} of 6`,
          exact: true,
        }),
      ).toBeVisible();
      const meta = await page.getByText(/^You are player/).innerText();
      const count = /Opponent hand: (\d+)/.exec(meta)?.[1];
      if (!count) throw new Error("Missing public hand count");
      const backs = page.getByRole("group", {
        name: `Opponent hand: ${count} face-down cards`,
        exact: true,
      });
      await expect(
        backs.getByRole("article", { name: "Face-down card", exact: true }),
      ).toHaveCount(Number(count));
      await expect(
        backs.getByRole("img", { name: "Art placeholder" }),
      ).toHaveCount(0);
      if (turn === 6) {
        const backsBox = await backs.boundingBox();
        const firstLaneBox = await page
          .getByRole("region", { name: "Lane 1", exact: true })
          .boundingBox();
        if (!backsBox || !firstLaneBox) throw new Error("Missing final board");
        expect(firstLaneBox.y).toBeGreaterThanOrEqual(
          backsBox.y + backsBox.height,
        );
      }
      for (let lane = 1; lane <= 3; lane++) {
        const own = (records.get(page) ?? []).filter(
          (card) => card.lane === lane,
        );
        const opponent = (records.get(page === a ? b : a) ?? []).filter(
          (card) => card.lane === lane,
        );
        const region = page.getByRole("region", {
          name: `Lane ${String(lane)}`,
          exact: true,
        });
        await expect(
          region.getByText(
            `Opponent total: ${String(opponent.reduce((sum, card) => sum + card.power, 0))} · Your total: ${String(own.reduce((sum, card) => sum + card.power, 0))}`,
            { exact: true },
          ),
        ).toBeVisible();
        for (const [label, cards] of [
          ["Your cards", own],
          ["Opponent cards", opponent],
        ] satisfies [string, typeof own][]) {
          const group = region.getByRole("group", { name: label });
          await expect(group.getByRole("article")).toHaveCount(cards.length);
          for (const card of cards) {
            const article = group.getByRole("article", {
              name: card.name,
              exact: true,
            });
            await expect(article).toBeVisible();
            await expect(async () => {
              const box = await article.boundingBox();
              const nameBox = await article
                .getByText(card.name, { exact: true })
                .boundingBox();
              const regionBox = await region.boundingBox();
              if (!box || !nameBox || !regionBox)
                throw new Error("Missing card text or lane");
              expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(
                box.y + box.height + 1,
              );
              expect(box.y + box.height).toBeLessThanOrEqual(
                regionBox.y + regionBox.height + 1,
              );
            }).toPass({ timeout: 1000 });
          }
        }
      }
    }
  }
});

test("inspect and select a card, then play it with the keyboard", async ({
  pair: [a, b],
}) => {
  await reachPlayableTurn(a, b);
  const hand = a.getByRole("region", { name: "Hand", exact: true });
  const card = hand
    .getByRole("article")
    .filter({
      has: a
        .getByRole("button", { name: /Stage .* in lane 1$/ })
        .and(a.locator(":enabled")),
    })
    .first();
  const name = await card.getAttribute("aria-label");
  await card.getByRole("button", { name: /Inspect/ }).focus();
  await a.keyboard.press("Enter");
  const sheet = a.getByRole("dialog");
  await expect(sheet).toContainText(name ?? "");
  await expect(sheet).toContainText("Power");
  await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();
  await a.keyboard.press("Enter");
  const target = a.getByRole("button", {
    name: "Play selected card in lane 1",
    exact: true,
  });
  for (let step = 0; step < 60; step++) {
    if (await target.and(a.locator(":focus")).count()) break;
    await a.keyboard.press("Shift+Tab");
  }
  await expect(target).toBeFocused();
  await a.keyboard.press("Enter");
  await expect(
    a.getByRole("button", { name: `Unstage ${name ?? ""}`, exact: true }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Commit", exact: true }).click();
  await b.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(
    b
      .getByRole("region", { name: "Lane 1", exact: true })
      .getByRole("group", { name: "Opponent cards" })
      .getByRole("article", { name: name ?? "", exact: true }),
  ).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`pointer drag plays inside the scaled board at ${String(width)}`, async ({
    pair: [a, b],
  }) => {
    await a.setViewportSize({ width, height: 900 });
    await reachPlayableTurn(a, b);
    const card = a
      .getByRole("region", { name: "Hand", exact: true })
      .getByRole("article")
      .filter({
        has: a
          .getByRole("button", { name: /Stage .* in lane 1$/ })
          .and(a.locator(":enabled")),
      })
      .first();
    const name = await card.getAttribute("aria-label");
    const original = await card.boundingBox();
    const cost = await card.getByRole("img", { name: /^Cost / }).boundingBox();
    const source = await card
      .getByRole("img", { name: "Art placeholder" })
      .boundingBox();
    const target = await a
      .getByRole("region", { name: "Lane 1", exact: true })
      .getByRole("group", { name: "Your cards" })
      .boundingBox();
    if (!source || !target) throw new Error("Missing drag endpoints");
    await a.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await a.mouse.down();
    await a.mouse.move(
      source.x + source.width / 2 + 15,
      source.y + source.height / 2,
      { steps: 5 },
    );
    await a.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 20 },
    );
    const preview = a
      .getByRole("article", { name: name ?? "", exact: true })
      .last();
    const previewBox = await preview.boundingBox();
    const previewCost = await preview
      .getByRole("img", { name: /^Cost / })
      .boundingBox();
    if (!original || !previewBox || !cost || !previewCost)
      throw new Error("Missing drag preview");
    expect(previewBox.width).toBeCloseTo(original.width, 0);
    expect(previewBox.height).toBeCloseTo(original.height, 0);
    expect(previewCost.height).toBeCloseTo(cost.height, 0);
    await a.mouse.up();
    // A commit during settle must wait for the dropped play to enter staging.
    await expect(
      a.getByRole("button", { name: "Commit", exact: true }),
    ).toBeDisabled();
    // Observe the public card geometry during settle: a frozen overlay fails this.
    await expect
      .poll(
        async () => (await preview.boundingBox())?.width ?? original.width,
        { timeout: 200, intervals: [16] },
      )
      .toBeLessThan(original.width - 3);
    await expect(
      a.getByRole("button", { name: `Unstage ${name ?? ""}`, exact: true }),
    ).toBeVisible();
    const landed = a
      .getByRole("region", { name: "Lane 1", exact: true })
      .getByRole("article", { name: name ?? "", exact: true });
    const opacity = await landed.evaluate((element) => {
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement)
        opacity *= Number(getComputedStyle(node).opacity);
      return opacity;
    });
    expect(opacity).toBeGreaterThan(0.95);
    await a
      .getByRole("button", { name: `Unstage ${name ?? ""}`, exact: true })
      .click();
    const returned = a
      .getByRole("region", { name: "Hand", exact: true })
      .getByRole("article", { name: name ?? "", exact: true });
    await expect(returned).toBeVisible();
    const widths = await returned.evaluate(async (element) => {
      const widths = [];
      for (let frame = 0; frame < 16; frame++) {
        widths.push(element.getBoundingClientRect().width);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            resolve();
          }),
        );
      }
      return widths;
    });
    expect(Math.max(...widths)).toBeLessThanOrEqual(original.width + 2);
    await returned.getByRole("button", { name: /Stage .* in lane 1$/ }).click();
    await expect(
      a.getByRole("button", { name: `Unstage ${name ?? ""}`, exact: true }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Commit", exact: true }).click();
    await b.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(
      b
        .getByRole("region", { name: "Lane 1", exact: true })
        .getByRole("group", { name: "Opponent cards" })
        .getByRole("article", { name: name ?? "", exact: true }),
    ).toBeVisible();
  });
}

test("touch drag stages a card inside the scaled phone board", async ({
  browser,
  address,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const other = await browser.newContext();
  try {
    const a = await context.newPage();
    const b = await other.newPage();
    for (const page of [a, b]) {
      await page.goto(address);
      await page
        .getByRole("button", { name: "Find match", exact: true })
        .click();
    }
    for (let turn = 1; turn < 6; turn++) {
      for (const page of [a, b]) {
        await expect(
          page.getByRole("heading", { name: `Turn ${String(turn)} of 6` }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Commit", exact: true }).click();
      }
    }
    await expect(a.getByRole("heading", { name: "Turn 6 of 6" })).toBeVisible();
    const cdp = await context.newCDPSession(a);
    const hand = a.getByRole("region", { name: "Hand", exact: true });
    const handBox = await hand.boundingBox();
    if (!handBox) throw new Error("Missing hand");
    for (let swipe = 0; swipe < 3; swipe++) {
      const x = handBox.x + handBox.width - 15;
      const y = handBox.y + handBox.height / 2;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 10; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x - ((handBox.width - 30) * step) / 10, y }],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
    const card = a
      .getByRole("region", { name: "Hand", exact: true })
      .getByRole("article")
      .filter({
        has: a
          .getByRole("button", { name: /Stage .* in lane 1$/ })
          .and(a.locator(":enabled")),
      })
      .last();
    const name = await card.getAttribute("aria-label");
    await expect
      .poll(async () => {
        const box = await card.boundingBox();
        return box ? box.x + box.width : Infinity;
      })
      .toBeLessThanOrEqual(handBox.x + handBox.width);
    const source = await card
      .getByRole("img", { name: "Art placeholder" })
      .boundingBox();
    const target = await a
      .getByRole("region", { name: "Lane 1", exact: true })
      .getByRole("group", { name: "Your cards" })
      .boundingBox();
    if (!source || !target) throw new Error("Missing touch endpoints");
    const x = source.x + source.width / 2;
    const y = source.y + source.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    // dnd-kit's default touch sensor uses a hold to distinguish dragging from scrolling.
    await expect(
      a.getByRole("article", { name: name ?? "", exact: true }),
    ).toHaveCount(2);
    for (let step = 1; step <= 20; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: x + ((target.x + target.width / 2 - x) * step) / 20,
            y: y + ((target.y + target.height / 2 - y) * step) / 20,
          },
        ],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(
      a.getByRole("button", { name: `Unstage ${name ?? ""}`, exact: true }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Commit", exact: true }).click();
    await b.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(
      b
        .getByRole("region", { name: "Lane 1", exact: true })
        .getByRole("group", { name: "Opponent cards" })
        .getByRole("article", { name: name ?? "", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await other.close();
  }
});

for (const width of [390, 1440]) {
  test(`illegal drops return to hand at ${String(width)}`, async ({
    page,
    address,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.routeWebSocket("**/ws", (socket) => {
      socket.send(JSON.stringify({ type: "welcome" }));
      socket.send(
        JSON.stringify({
          type: "state",
          view: {
            player: 0,
            phase: "planning",
            result: null,
            turn: 1,
            energy: 1,
            own: {
              hand: [
                { id: "cheap", name: "Test herald", cost: 1, power: 2 },
                { id: "costly", name: "Test sentinel", cost: 2, power: 4 },
              ],
              staged: [],
              committed: false,
              deckSize: 6,
              lanes: [
                [1, 2, 3, 4].map((n) => ({
                  id: `full-${String(n)}`,
                  name: `Guard ${String(n)}`,
                  cost: 1,
                  power: 2,
                })),
                [],
                [],
              ],
            },
            opponent: {
              handSize: 3,
              deckSize: 9,
              committed: false,
              lanes: [[], [], []],
            },
            events: [],
          },
        }),
      );
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await page.goto(address);
    await expect(page).toHaveURL(/\/match$/);
    for (const [name, lane] of [
      ["Test herald", 1],
      ["Test sentinel", 2],
    ] satisfies [string, number][]) {
      const hand = page.getByRole("region", { name: "Hand", exact: true });
      const card = hand.getByRole("article", { name, exact: true });
      await card.click({ trial: true });
      const before = await card.boundingBox();
      const source = await card
        .getByRole("img", { name: "Art placeholder" })
        .boundingBox();
      const target = await page
        .getByRole("region", { name: `Lane ${String(lane)}`, exact: true })
        .getByRole("group", { name: "Your cards" })
        .boundingBox();
      if (!source || !target || !before)
        throw new Error("Missing drag endpoints");
      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        source.x + source.width / 2 + 15,
        source.y + source.height / 2,
        { steps: 5 },
      );
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { steps: 20 },
      );
      await expect(
        page.getByRole("button", {
          name: `Play selected card in lane ${String(lane)}`,
          exact: true,
        }),
      ).toHaveText("Unavailable");
      await page.mouse.up();
      await expect(page.getByRole("button", { name: /Unstage/ })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("article", { name, exact: true }),
      ).toHaveCount(1);
      await expect(card).toBeVisible();
      await expect
        .poll(async () => (await card.boundingBox())?.x)
        .toBeCloseTo(before.x, 0);
    }
  });
}

test("tap a card then tap a lane without closing inspection", async ({
  pair: [a, b],
}) => {
  await a.setViewportSize({ width: 390, height: 844 });
  await reachPlayableTurn(a, b);
  const card = a
    .getByRole("region", { name: "Hand", exact: true })
    .getByRole("article")
    .filter({
      has: a
        .getByRole("button", { name: /Stage .* in lane 1$/ })
        .and(a.locator(":enabled")),
    })
    .first();
  const name = await card.getAttribute("aria-label");
  const board = a.getByRole("region", { name: "Match board", exact: true });
  const before = await board.boundingBox();
  await card.getByRole("img", { name: "Art placeholder" }).click();
  await expect(a.getByRole("dialog")).toBeVisible();
  expect(await board.boundingBox()).toEqual(before);
  const sheet = await a.getByRole("dialog").boundingBox();
  if (!sheet) throw new Error("Missing inspection sheet");
  expect(sheet.y + sheet.height).toBeCloseTo(844, 0);
  await a
    .getByRole("button", { name: "Play selected card in lane 1", exact: true })
    .click();
  await expect(a.getByRole("dialog")).toHaveCount(0);
  await expect(
    a.getByRole("button", { name: `Unstage ${name ?? ""}`, exact: true }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Commit", exact: true }).click();
  await b.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(
    b
      .getByRole("region", { name: "Lane 1", exact: true })
      .getByRole("group", { name: "Opponent cards" })
      .getByRole("article", { name: name ?? "", exact: true }),
  ).toBeVisible();
});

test("direct staging clears card selection and inspection", async ({
  pair: [a, b],
}) => {
  const direct = await reachPlayableTurn(a, b);
  const label = await direct.getAttribute("aria-label");
  const name = label?.replace(/^Stage /, "").replace(/ in lane \d+$/, "");
  if (!name) throw new Error("Missing playable card");
  await a.getByRole("button", { name: `Inspect ${name}`, exact: true }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await direct.click();
  await expect(a.getByRole("dialog")).toHaveCount(0);
  await expect(
    a.getByRole("button", { name: /Play selected card in lane/ }),
  ).toHaveText(["Play here", "Play here", "Play here"]);
  await a.getByRole("button", { name: `Unstage ${name}`, exact: true }).click();
  await a.getByRole("button", { name: `Inspect ${name}`, exact: true }).click();
  await a.keyboard.press("Escape");
  await expect(a.getByRole("dialog")).toHaveCount(0);
  for (const target of await a
    .getByRole("button", { name: /Play selected card in lane/ })
    .all())
    await expect(target).toBeDisabled();
});

for (const changeDuringMatch of [false, true]) {
  test(`reduced motion drag settles promptly (live change: ${String(changeDuringMatch)})`, async ({
    page,
    address,
  }) => {
    await page.emulateMedia({
      reducedMotion: changeDuringMatch ? "no-preference" : "reduce",
    });
    const card = { id: "herald", name: "Test herald", cost: 1, power: 2 };
    const view = {
      player: 0,
      phase: "planning",
      result: null,
      turn: 1,
      energy: 1,
      own: {
        hand: [card],
        staged: [],
        committed: false,
        deckSize: 6,
        lanes: [[], [], []],
      },
      opponent: {
        handSize: 3,
        deckSize: 9,
        committed: false,
        lanes: [[], [], []],
      },
      events: [],
    };
    await page.routeWebSocket("**/ws", (socket) => {
      socket.send(JSON.stringify({ type: "welcome" }));
      socket.send(JSON.stringify({ type: "state", view }));
      socket.onMessage(() => {
        socket.send(
          JSON.stringify({
            type: "state",
            view: {
              ...view,
              own: { ...view.own, staged: [{ cardId: card.id, lane: 0 }] },
            },
          }),
        );
      });
    });
    await page.goto(address);
    await expect(page).toHaveURL(/\/match$/);
    await page.getByRole("heading", { name: "Turn 1 of 6" }).waitFor();
    if (changeDuringMatch) await page.emulateMedia({ reducedMotion: "reduce" });
    const source = await page
      .getByRole("region", { name: "Hand", exact: true })
      .getByRole("article", { name: card.name, exact: true })
      .getByRole("img", { name: "Art placeholder" })
      .boundingBox();
    const lane = page
      .getByRole("region", { name: "Lane 1", exact: true })
      .getByRole("group", { name: "Your cards" });
    const target = await lane.boundingBox();
    if (!source || !target) throw new Error("Missing drag endpoints");
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();
    await expect(
      lane.getByRole("article", { name: card.name, exact: true }),
    ).toBeVisible({ timeout: 150 });
    await expect(
      page.getByRole("article", { name: card.name, exact: true }),
    ).toHaveCount(1);
  });
}

for (const finish of [
  "timeline",
  "skip",
  "escape",
  "reduced",
  "interrupt",
  "update",
]) {
  test(`reveal order and authoritative totals: ${finish}`, async ({
    page,
    address,
  }) => {
    const { staging, revealed, guardian } =
      await import("../src/client/stories/fixtures.ts");
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-01-01T00:00:00Z"));
    let update: (() => void) | undefined;
    await page.emulateMedia({
      reducedMotion: finish === "reduced" ? "reduce" : "no-preference",
    });
    await page.routeWebSocket("**/ws", (socket) => {
      socket.send(JSON.stringify({ type: "welcome" }));
      socket.send(JSON.stringify({ type: "state", view: staging }));
      socket.onMessage(() => {
        socket.send(JSON.stringify({ type: "state", view: revealed }));
        if (finish === "interrupt" || finish === "update")
          update = () => {
            socket.send(
              JSON.stringify({
                type: "state",
                view:
                  finish === "update"
                    ? {
                        ...revealed,
                        opponent: { ...revealed.opponent, committed: true },
                      }
                    : { ...revealed, turn: 5, energy: 5 },
              }),
            );
          };
      });
    });
    await page.goto(address);
    await page.getByRole("button", { name: "Commit", exact: true }).click();
    const own = page.getByRole("region", { name: "Lane 2", exact: true });
    const opponent = page.getByRole("region", { name: "Lane 1", exact: true });
    if (
      finish === "timeline" ||
      finish === "interrupt" ||
      finish === "update"
    ) {
      await page.clock.runFor(360);
      await expect(
        page.getByText(`Revealed ${guardian.name}`, { exact: true }),
      ).toBeVisible();
      await expect(
        own.getByText("Opponent total: 3 · Your total: 4", { exact: true }),
      ).toBeVisible();
      await expect(
        opponent
          .getByRole("group", { name: "Opponent cards" })
          .getByRole("article"),
      ).toHaveCount(0);
      update?.();
      await page.clock.runFor(360);
      await expect(
        page.getByText("Revealed Vulcan, Ember Shaper", { exact: true }),
      ).toBeVisible();
      await page.clock.runFor(360);
      await expect(page.getByText("Turn ended", { exact: true })).toBeVisible();
    }
    if (["timeline", "interrupt", "update"].includes(finish))
      await page.clock.runFor(360);
    if (finish === "skip")
      await page
        .getByRole("button", { name: "Skip reveal", exact: true })
        .click();
    if (finish === "escape") await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Skip reveal", exact: true }),
    ).toHaveCount(0);
    await expect(
      opponent.getByText("Opponent total: 5 · Your total: 2", { exact: true }),
    ).toBeVisible();
    await expect(
      own.getByText("Opponent total: 3 · Your total: 4", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: finish === "interrupt" ? "Turn 5 of 6" : "Turn 4 of 6",
      }),
    ).toBeVisible();
  });
}

test("two players reveal both sides and agree on lane totals", async ({
  pair: [a, b],
}) => {
  // By turn three every opening hand contains an affordable card.
  for (let turn = 1; turn < 3; turn++) {
    for (const page of [a, b])
      await page.getByRole("button", { name: "Commit", exact: true }).click();
    for (const page of [a, b])
      await expect(
        page.getByRole("heading", { name: `Turn ${String(turn + 1)} of 6` }),
      ).toBeVisible();
  }
  for (const page of [a, b]) {
    await page
      .getByRole("button", { name: /Stage .* in lane 1$/ })
      .and(page.locator(":enabled"))
      .first()
      .click();
    await page.getByRole("button", { name: "Commit", exact: true }).click();
  }
  const totals: string[] = [];
  for (const page of [a, b]) {
    await expect(
      page.getByRole("heading", { name: "Turn 4 of 6" }),
    ).toBeVisible();
    const lane = page.getByRole("region", { name: "Lane 1", exact: true });
    for (const side of ["Your cards", "Opponent cards"])
      await expect(
        lane.getByRole("group", { name: side }).getByRole("article"),
      ).toHaveCount(1);
    totals.push(await lane.getByText(/^Opponent total:/).innerText());
  }
  const values = totals.map((text) => text.match(/\d+/g));
  expect(values[0]).toEqual(values[1]?.toReversed());
});

test("match-ending reveal stays on the board until playback finishes", async ({
  page,
  address,
}) => {
  const { staging, revealed, ended, guardian } =
    await import("../src/client/stories/fixtures.ts");
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:00Z"));
  await page.routeWebSocket("**/ws", (socket) => {
    socket.send(JSON.stringify({ type: "welcome" }));
    socket.send(
      JSON.stringify({
        type: "state",
        view: { ...staging, turn: 6, energy: 6 },
      }),
    );
    socket.onMessage(() => {
      socket.send(
        JSON.stringify({
          type: "state",
          view: {
            ...ended,
            events: [...revealed.events.slice(0, 2), ...ended.events],
          },
        }),
      );
    });
  });
  await page.goto(address);
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Skip reveal", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Match result", exact: true }),
  ).toHaveCount(0);
  await page.clock.runFor(360);
  await expect(
    page.getByText(`Revealed ${guardian.name}`, { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(360);
  await expect(
    page.getByText("Revealed Vulcan, Ember Shaper", { exact: true }),
  ).toBeVisible();
  await page.clock.runFor(360);
  await expect(page.getByText("Turn ended", { exact: true })).toBeVisible();
  await page.clock.runFor(360);
  await expect(page.getByText("Match ended", { exact: true })).toBeVisible();
  await page.clock.runFor(360);
  await expect(
    page.getByRole("heading", { name: "Match result", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Lane 2", exact: true })
      .getByText("Opponent total: 3 · Your total: 4", { exact: true }),
  ).toBeVisible();
});
