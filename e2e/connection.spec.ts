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
      .getByRole("button")
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
  await expect(unaffordable.first().getByRole("button").first()).toBeDisabled();
  const stage = await reachPlayableTurn(a, b);
  const label =
    (await stage.getAttribute("aria-label")) ?? (await stage.innerText());
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
  await expect(hand.getByRole("button").and(a.locator(":enabled"))).toHaveCount(
    0,
  );
  await expect(
    b.getByText("Opponent has committed", { exact: true }),
  ).toBeVisible();
});

test("opponent staged cards stay hidden until resolution", async ({
  pair: [a, b],
}) => {
  const stage = await reachPlayableTurn(a, b);
  const label =
    (await stage.getAttribute("aria-label")) ?? (await stage.innerText());
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
    await a.getByRole("button", { name: "Commit", exact: true }).click();
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
