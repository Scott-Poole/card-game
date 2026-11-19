import type { Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const noZones = { destroyed: [], discarded: [], banished: [] };
const locations = ["Place A", "Place B", "Place C"].map((name, index) => ({
  id: `place-${String(index)}`,
  name,
  text: "No effect for now.",
  effect: { kind: "none" },
}));
const commitButton = (page: Page) =>
  page.getByRole("button", { name: /^End turn \d+\/6$/ });
// Welcome received: the action that needs a connection is enabled, no trouble indicator shown.
async function expectConnected(page: Page, action: string) {
  await expect(
    page.getByRole("button", { name: action, exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("status").filter({ hasText: /connect|error/ }),
  ).toHaveCount(0);
}
// The Result panel's totals as [yours, opponent's], and its lanes-won counts.
async function resultTotals(page: Page) {
  const text = await page
    .getByRole("region", { name: "Match result" })
    .getByText(/^Total power:/)
    .innerText();
  const found = /^Total power: You (\d+) · Opponent (\d+)$/.exec(text);
  if (!found) throw new Error(`Unexpected totals: ${text}`);
  return [Number(found[1]), Number(found[2])] as const;
}
async function lanesWon(page: Page) {
  const text = await page
    .getByRole("region", { name: "Match result" })
    .getByText(/^Lanes won:/)
    .innerText();
  const found = /^Lanes won: You (\d) · Opponent (\d)$/.exec(text);
  if (!found) throw new Error(`Unexpected lanes won: ${text}`);
  return [Number(found[1]), Number(found[2])] as const;
}
const energy = (page: Page) =>
  page.getByRole("meter", { name: "Energy remaining" });
const test = base.extend<{
  address: string;
  pair: readonly [Page, Page];
  controlledClock: boolean;
  // "plain" (default, so totals equal printed power) and "boosted" pin the
  // pool through e2e/server.ts; "shipped" is the real random pool.
  locationPool: "shipped" | "plain" | "boosted";
}>({
  controlledClock: [false, { option: true }],
  locationPool: ["plain", { option: true }],
  pair: async ({ browser, address, controlledClock }, use) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    try {
      const pages = [await first.newPage(), await second.newPage()] satisfies [
        Page,
        Page,
      ];
      for (const page of pages) {
        if (controlledClock)
          await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
        await page.goto(address);
        await page
          .getByRole("button", { name: "Find match", exact: true })
          .click();
      }
      for (const page of pages)
        await expect(
          page.getByRole("button", { name: "End turn 1/6" }),
        ).toBeVisible();
      await use(pages);
    } finally {
      await first.close();
      await second.close();
    }
  },
  address: async ({ browserName, locationPool }, use) => {
    // Keep the browser fixture dependent on a built-in Playwright fixture.
    expect(browserName).toBe("chromium");
    const server = spawn(
      process.execPath,
      [locationPool === "shipped" ? "src/server/main.ts" : "e2e/server.ts"],
      {
        env: {
          ...process.env,
          PORT: "0",
          CLIENT_DIRECTORY: "dist",
          E2E_LOCATIONS: locationPool,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
  await expectConnected(page, "Find match");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(21, 23, 25)",
  );
  await page.keyboard.press("Tab");
  const join = page.getByRole("button", { name: "Find match", exact: true });
  await expect(join).toBeFocused();
  await expect(join).toHaveCSS("outline-offset", "2px");

  await page.reload();
  await expectConnected(page, "Find match");
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

test("the Reveals first tag follows the view's seat and holds through playback", async ({
  page,
  address,
}) => {
  const { staging, revealed, herald, guardian, voyager } =
    await import("../src/client/stories/fixtures.ts");
  // The opponent leads `staging` (it reveals first); after the turn our boosted
  // board leads instead (lanes level, power 9 to 8), so the order flips to us.
  const next = {
    ...revealed,
    revealFirst: 0,
    own: { ...revealed.own, lanes: [[herald], [guardian, voyager], []] },
  } satisfies typeof revealed;
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:00Z"));
  await page.routeWebSocket("**/ws", (socket) => {
    socket.send(JSON.stringify({ type: "welcome" }));
    socket.send(JSON.stringify({ type: "state", view: staging }));
    socket.onMessage(() => {
      // The resolved frame already names the next turn's order.
      socket.send(JSON.stringify({ type: "state", view: next }));
    });
  });
  await page.goto(address);
  const lit = page.locator("[data-reveals-first]");
  await expect(lit).toHaveCount(1);
  await expect(lit).toHaveText("Opponent · Player 2 · Reveals first");
  await commitButton(page).click();
  await page.clock.runFor(360);
  await expect(
    page.getByRole("button", { name: "Skip reveal", exact: true }),
  ).toBeVisible();
  // Mid-playback the tag still shows the order of the turn being played.
  await expect(lit).toHaveText("Opponent · Player 2 · Reveals first");
  await page.getByRole("button", { name: "Skip reveal", exact: true }).click();
  await expect(lit).toHaveCount(1);
  await expect(lit).toHaveText("You · Player 1 · Reveals first");
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
          page.getByRole("button", { name: `End turn ${String(turn)}/6` }),
        ).toBeVisible();
        const playable = page
          .getByRole("button", { name: /Stage .* in lane/ })
          .and(page.locator(":enabled"));
        if (await playable.count()) {
          await playable.first().press("Enter");
          stagedPlayers.add(page);
          await expect(
            page.getByRole("button", { name: /Unstage/ }),
          ).toHaveCount(1);
        }
        await commitButton(page).click();
      }
    }
    expect(stagedPlayers.size).toBe(2);
    for (const page of pages)
      await expect(
        page.getByRole("heading", { name: "Match result" }),
      ).toBeVisible();
    for (const page of pages) {
      // The action bar keeps its row after the match ends.
      const result = page.getByRole("button", { name: "View result" });
      await expect(result).toBeEnabled();
      const orb = await energy(page).boundingBox();
      const button = await result.boundingBox();
      if (!orb || !button) throw new Error("Missing ended action bar");
      expect(
        Math.abs(orb.y + orb.height / 2 - (button.y + button.height / 2)),
      ).toBeLessThan(orb.height / 2);
      expect(orb.x + orb.width).toBeLessThanOrEqual(button.x);
    }
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
    const power = await Promise.all(pages.map(resultTotals));
    expect(power[0]).toEqual([power[1]?.[1], power[1]?.[0]]);
    const won = await Promise.all(pages.map(lanesWon));
    expect(won[0]).toEqual([won[1]?.[1], won[1]?.[0]]);
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
        page.getByRole("button", { name: `End turn ${String(turn)}/6` }),
      ).toBeVisible();
    const enabled = a
      .getByRole("region", { name: "Hand" })
      .getByRole("button", { name: /Stage .* in lane/ })
      .and(a.locator(":enabled"));
    if (await enabled.count()) return enabled.first();
    await commitButton(a).click();
    await commitButton(b).click();
  }
  throw new Error("No playable card in six turns");
}

test.describe("shipped location pool", () => {
  test.use({ locationPool: "shipped" });
  test("both players see the same three locations, one per lane in lane order", async ({
    pair,
  }) => {
    const { locations: pool } = await import("../src/server/locations.ts");
    const seen = [];
    for (const page of pair) {
      const names = [];
      for (const number of [1, 2, 3]) {
        const lane = page.getByRole("region", {
          name: `Lane ${String(number)}`,
          exact: true,
        });
        const text = (await lane.textContent()) ?? "";
        const matches = pool.filter(({ name }) => text.includes(name));
        expect(matches).toHaveLength(1);
        await expect(lane).toContainText(matches[0]?.text ?? "");
        names.push(matches[0]?.name);
      }
      expect(new Set(names).size).toBe(3);
      seen.push(names);
    }
    expect(seen[0]).toEqual(seen[1]);
  });
});
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
  await stage.press("Enter");
  const unstage = a.getByRole("button", { name: /Unstage/ });
  await expect(unstage).toBeEnabled();
  await unstage.click();
  await expect(
    hand.getByRole("button", { name: label, exact: true }),
  ).toBeEnabled();
  await hand.getByRole("button", { name: label, exact: true }).press("Enter");
  await expect(unstage).toBeEnabled();
  await commitButton(a).click();
  await expect(unstage).toBeDisabled();
  await expect(
    a.getByRole("button", { name: "Waiting for opponent…", exact: true }),
  ).toBeDisabled();

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
  await stage.press("Enter");
  await expect(
    a.getByRole("button", { name: `Unstage ${name}`, exact: true }),
  ).toBeEnabled();
  await expect(b.locator("body")).toHaveText(before, { useInnerText: true });
  await expect(
    b.getByRole("region", { name: "Staged cards" }).getByRole("listitem"),
  ).toHaveCount(0);
  await commitButton(a).click();
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
  await commitButton(b).click();
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
  // Lane stats from an abandoned board would contradict the forced win.
  await expect(a.getByText(/^Lane scores/)).toHaveCount(0);
  await expect(a.getByText(/^Lanes won:/)).toHaveCount(0);
  await expect(a.getByText(/^Total power:/)).toHaveCount(0);
});

test("opponent updates do not unlock an unacknowledged stage", async ({
  page,
  address,
}) => {
  const view = {
    player: 0,
    turn: 1,
    energy: 1,
    revealFirst: 0,
    locations,
    phase: "planning",
    result: null,
    own: {
      hand: [
        { id: "a", name: "Asteron", cost: 1, power: 2 },
        { id: "b", name: "Thaleia", cost: 1, power: 2 },
      ],
      staged: [],
      deckSize: 10,
      zones: noZones,
      committed: false,
      lanes: [[], [], []],
    },
    opponent: {
      handSize: 3,
      deckSize: 9,
      zones: noZones,
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
    .press("Enter");
  await expect(
    page.getByText("Opponent has committed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stage Thaleia in lane 1", exact: true }),
  ).toBeDisabled();
  await expect(commitButton(page)).toBeDisabled();
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
  await expectConnected(page, "Find match");
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

test("player flow on a phone: join, drag and tap plays, reveal, Result, Play again, rematch", async ({
  pair: [a, b],
  address,
}) => {
  test.setTimeout(60_000);
  const phone = { width: 390, height: 844 };
  await Promise.all([a, b].map((page) => page.setViewportSize(phone)));
  const playable = (page: Page) =>
    page
      .getByRole("region", { name: "Hand", exact: true })
      .getByRole("article")
      .filter({
        has: page
          .getByRole("button", { name: /Stage .* in lane 1$/ })
          .and(page.locator(":enabled")),
      })
      .first();
  // Empty commits are legal, so wait for the turn on which both hands can play.
  let turn = 1;
  for (; ; turn++) {
    if (turn > 6) throw new Error("No turn where both players can play");
    for (const page of [a, b])
      await expect(
        page.getByRole("button", { name: `End turn ${String(turn)}/6` }),
      ).toBeVisible();
    if ((await playable(a).count()) && (await playable(b).count())) break;
    await commitButton(a).click();
    await commitButton(b).click();
  }
  // Dev-only placeholders never ship in the production build.
  await expect(a.getByText("Retreat")).toHaveCount(0);

  // Player one drags a card into lane 1.
  const dragged = await playable(a).getAttribute("aria-label");
  const source = await playable(a)
    .getByRole("img", { name: "Art placeholder" })
    .boundingBox();
  const target = await a
    .getByRole("region", { name: "Lane 1", exact: true })
    .getByRole("group", { name: "Your cards" })
    .boundingBox();
  if (!source || !target) throw new Error("Missing drag endpoints");
  await a.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
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
  await a.mouse.up();
  await expect(
    a.getByRole("button", { name: `Unstage ${dragged ?? ""}`, exact: true }),
  ).toBeVisible();

  // Player two taps a card, then taps lane 1 in the inspection sheet.
  const tapped = await playable(b).getAttribute("aria-label");
  await playable(b).getByRole("img", { name: "Art placeholder" }).click();
  await b
    .getByRole("button", { name: "Play selected card in lane 1", exact: true })
    .click();
  await expect(
    b.getByRole("button", { name: `Unstage ${tapped ?? ""}`, exact: true }),
  ).toBeVisible();

  await commitButton(a).click();
  await commitButton(b).click();
  // Each side sees the other's card once the reveal plays.
  await expect(
    a
      .getByRole("region", { name: "Lane 1", exact: true })
      .getByRole("group", { name: "Opponent cards" })
      .getByRole("article", { name: tapped ?? "", exact: true }),
  ).toBeVisible();
  await expect(
    b
      .getByRole("region", { name: "Lane 1", exact: true })
      .getByRole("group", { name: "Opponent cards" })
      .getByRole("article", { name: dragged ?? "", exact: true }),
  ).toBeVisible();

  for (turn += 1; turn <= 6; turn++) {
    for (const page of [a, b]) {
      await expect(
        page.getByRole("button", { name: `End turn ${String(turn)}/6` }),
      ).toBeVisible();
      await commitButton(page).click();
    }
  }
  for (const page of [a, b]) {
    await expect(page).toHaveURL(address + "/result");
    await page
      .getByRole("button", { name: "View result", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Match result", exact: true }),
    ).toBeInViewport();
  }
  const winners = await Promise.all(
    [a, b].map((page) => page.getByLabel("Winner").innerText()),
  );
  expect([...winners].sort()).toEqual(
    winners[0] === "Draw" ? ["Draw", "Draw"] : ["You lose", "You win"],
  );
  const power = await Promise.all([a, b].map(resultTotals));
  expect(power[0]).toEqual([power[1]?.[1], power[1]?.[0]]);
  const won = await Promise.all([a, b].map(lanesWon));
  expect(won[0]).toEqual([won[1]?.[1], won[1]?.[0]]);
  // Totals are the viewer's own, not swapped: they match the per-lane totals
  // the board shows, and the winner follows lanes won, then total power.
  for (const [index, page] of [a, b].entries()) {
    const shown = await page
      .getByRole("region", { name: /^Lane \d$/ })
      .getByText(/^Opponent total: \d+ · Your total: \d+$/)
      .allTextContents();
    const sum = (side: "Your" | "Opponent") =>
      shown.reduce(
        (total, text) =>
          total +
          Number(new RegExp(`${side} total: (\\d+)`).exec(text)?.[1] ?? NaN),
        0,
      );
    expect(power[index]).toEqual([sum("Your"), sum("Opponent")]);
    const [mine, theirs] = won[index] ?? [0, 0];
    const [myPower, theirPower] = power[index] ?? [0, 0];
    expect(winners[index]).toBe(
      mine !== theirs
        ? mine > theirs
          ? "You win"
          : "You lose"
        : myPower === theirPower
          ? "Draw"
          : myPower > theirPower
            ? "You win"
            : "You lose",
    );
  }
  const lanes = await a
    .getByRole("region", { name: "Match result" })
    .getByRole("listitem")
    .allTextContents();
  expect(lanes.filter((text) => text.endsWith("You win"))).toHaveLength(
    won[0]?.[0] ?? -1,
  );
  expect(lanes.filter((text) => text.endsWith("You lose"))).toHaveLength(
    won[0]?.[1] ?? -1,
  );

  // Play again returns a player to Home and they can queue while the other
  // player is still reading their Result; the opponent then joins from there.
  await a.getByRole("button", { name: "Play again", exact: true }).click();
  await expect(a).toHaveURL(address + "/");
  await expect(
    a.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Play", exact: true }).click();
  await expect(a.getByText("Waiting for an opponent…")).toBeVisible();
  await expect(b).toHaveURL(address + "/result");
  await b.getByRole("button", { name: "Play again", exact: true }).click();
  await expect(b).toHaveURL(address + "/");
  await b.getByRole("button", { name: "Play", exact: true }).click();
  for (const page of [a, b])
    await expect(
      page.getByRole("button", { name: "End turn 1/6" }),
    ).toBeVisible();
  await expect(a).toHaveURL(address + "/match");
  await expect(b).toHaveURL(address + "/match");
});

test("Play joins and moves to Waiting; a state message moves to Match and Result", async ({
  browser,
  page,
  address,
}) => {
  await page.goto(address);
  await expectConnected(page, "Play");
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
  await commitButton(a).click();
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
  await expectConnected(a, "Play");
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
    await expect(energy(a)).toHaveAttribute("aria-valuenow", "1");
    await expect(energy(a)).toHaveAttribute("aria-valuemax", "1");
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
    await commitButton(a).click();
    await expect(
      a.getByRole("button", { name: "Waiting for opponent…", exact: true }),
    ).toBeDisabled();
    expect(await lanes.boundingBox()).toEqual(laneBeforeCommit);
    await commitButton(b).click();
    await expect(a.getByRole("button", { name: "End turn 2/6" })).toBeVisible();
    await expect(energy(a)).toHaveAttribute("aria-valuenow", "2");
    await expect(a.getByText("Stakes", { exact: true })).toHaveCount(0);
    // The reserved retreat slot is empty in production builds.
    const bar = await commitButton(a).boundingBox();
    const orb = await energy(a).boundingBox();
    if (!bar || !orb) throw new Error("Missing action bar");
    expect(orb.x + orb.width).toBeLessThanOrEqual(bar.x);
  });
}

test("multiple staged cards can be returned from the portrait board", async ({
  pair: [a, b],
}) => {
  await a.setViewportSize({ width: 390, height: 844 });
  for (let turn = 1; turn < 6; turn++) {
    await commitButton(a).click();
    await commitButton(b).click();
    await expect(
      a.getByRole("button", { name: `End turn ${String(turn + 1)}/6` }),
    ).toBeVisible();
  }
  for (let count = 0; count < 2; count++) {
    const hand = a.getByRole("region", { name: "Hand", exact: true });
    const cheap = hand.getByRole("article").filter({ hasText: /Cost [1-3]/ });
    const play = cheap
      .getByRole("button", { name: /in lane 1$/ })
      .and(a.locator(":enabled"))
      .first();
    await play.press("Enter");
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
        page.getByRole("button", { name: `End turn ${String(turn)}/6` }),
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
        await play.press("Enter");
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
      await commitButton(page).click();
    }
    for (const page of [a, b]) {
      await expect(
        page.getByRole("button", {
          name: turn === 6 ? "View result" : `End turn ${String(turn + 1)}/6`,
          exact: true,
        }),
      ).toBeVisible();
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
  await commitButton(a).click();
  await commitButton(b).click();
  await expect(
    b
      .getByRole("region", { name: "Lane 1", exact: true })
      .getByRole("group", { name: "Opponent cards" })
      .getByRole("article", { name: name ?? "", exact: true }),
  ).toBeVisible();
});

test.describe("controlled drag animation", () => {
  test.use({ controlledClock: true });
  for (const width of [390, 1440]) {
    test(`pointer drag plays inside the scaled board at ${String(width)}`, async ({
      pair: [a, b],
    }) => {
      await a.setViewportSize({ width, height: 900 });
      await reachPlayableTurn(a, b);
      await a.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
      await a.clock.resume();

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
      const cost = await card
        .getByRole("img", { name: /^Cost / })
        .boundingBox();
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
      // Freeze page time before release so runner latency cannot skip the settle window.
      await a.clock.pauseAt(new Date("2026-01-01T00:02:00Z"));
      await a.mouse.up();
      // A commit during settle must wait for the dropped play to enter staging.
      await expect(commitButton(a)).toBeDisabled();
      await a.clock.runFor(60);
      await expect(commitButton(a)).toBeDisabled();
      // Observe the public card geometry during settle: a frozen overlay fails this.
      await expect
        .poll(
          async () => (await preview.boundingBox())?.width ?? original.width,
          { timeout: 200, intervals: [16] },
        )
        .toBeLessThan(original.width - 3);
      await a.clock.runFor(300);
      await a.clock.resume();
      await expect(
        a.getByRole("button", { name: `Unstage ${name ?? ""}`, exact: true }),
      ).toBeVisible();
      const landed = a
        .getByRole("region", { name: "Lane 1", exact: true })
        .getByRole("article", { name: name ?? "", exact: true });
      const opacity = await landed.evaluate((element) => {
        let opacity = 1;
        for (
          let node: Element | null = element;
          node;
          node = node.parentElement
        )
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
      await returned
        .getByRole("button", { name: /Stage .* in lane 1$/ })
        .press("Enter");
      await expect(
        a.getByRole("button", { name: `Unstage ${name ?? ""}`, exact: true }),
      ).toBeVisible();
      await commitButton(a).click();
      await commitButton(b).click();
      await expect(
        b
          .getByRole("region", { name: "Lane 1", exact: true })
          .getByRole("group", { name: "Opponent cards" })
          .getByRole("article", { name: name ?? "", exact: true }),
      ).toBeVisible();
    });
  }
});

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
          page.getByRole("button", { name: `End turn ${String(turn)}/6` }),
        ).toBeVisible();
        await commitButton(page).click();
      }
    }
    await expect(a.getByRole("button", { name: "End turn 6/6" })).toBeVisible();
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
    await commitButton(a).click();
    await commitButton(b).click();
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
            revealFirst: 0,
            locations,
            own: {
              hand: [
                { id: "cheap", name: "Test herald", cost: 1, power: 2 },
                { id: "costly", name: "Test sentinel", cost: 2, power: 4 },
              ],
              staged: [],
              committed: false,
              deckSize: 6,
              zones: noZones,
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
              zones: noZones,
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
    for (const [name, lane, reason] of [
      ["Test herald", 1, "Lane full"],
      ["Test sentinel", 2, "Unavailable"],
    ] satisfies [string, number, string][]) {
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
      ).toHaveText(reason);
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
  await expect
    .poll(async () => (await board.boundingBox())?.width)
    .toBeCloseTo(390, 0);
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
  await commitButton(a).click();
  await commitButton(b).click();
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
  await direct.press("Enter");
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
      revealFirst: 0,
      locations,
      own: {
        hand: [card],
        staged: [],
        committed: false,
        deckSize: 6,
        zones: noZones,
        lanes: [[], [], []],
      },
      opponent: {
        handSize: 3,
        deckSize: 9,
        zones: noZones,
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
    await page.getByRole("button", { name: "End turn 1/6" }).waitFor();
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
    await commitButton(page).click();
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
      page.getByRole("button", {
        name: finish === "interrupt" ? "End turn 5/6" : "End turn 4/6",
      }),
    ).toBeVisible();
  });
}

test("two players reveal both sides and agree on lane totals", async ({
  pair: [a, b],
}) => {
  // By turn three every opening hand contains an affordable card.
  for (let turn = 1; turn < 3; turn++) {
    for (const page of [a, b]) await commitButton(page).click();
    for (const page of [a, b])
      await expect(
        page.getByRole("button", { name: `End turn ${String(turn + 1)}/6` }),
      ).toBeVisible();
  }
  for (const page of [a, b]) {
    await page
      .getByRole("button", { name: /Stage .* in lane 1$/ })
      .and(page.locator(":enabled"))
      .first()
      .press("Enter");
    await commitButton(page).click();
  }
  const totals: string[] = [];
  for (const page of [a, b]) {
    await expect(
      page.getByRole("button", { name: "End turn 4/6" }),
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
  await commitButton(page).click();
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
  await expect(
    page.getByRole("heading", { name: "Match result", exact: true }),
  ).toHaveCount(0);
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

test("action bar: staging a card drops the energy orb, then commit waits", async ({
  pair: [a, b],
}) => {
  const stage = await reachPlayableTurn(a, b);
  const cost = Number(
    /Cost (\d)/.exec(
      await stage.locator("xpath=ancestor::article[1]").innerText(),
    )?.[1],
  );
  const before = Number(await energy(a).getAttribute("aria-valuenow"));
  await stage.press("Enter");
  await expect(energy(a)).toHaveAttribute(
    "aria-valuenow",
    String(before - cost),
  );
  await commitButton(a).click();
  await expect(
    a.getByRole("button", { name: "Waiting for opponent…", exact: true }),
  ).toBeDisabled();
  await expect(
    b.getByText("Opponent has committed", { exact: true }),
  ).toBeVisible();
});

test("planning board shows no debug text, heading or energy line", async ({
  pair: [a],
}) => {
  await expect(a.getByText(/^You are player/)).toHaveCount(0);
  await expect(a.getByText(/Opponent hand:/)).toHaveCount(0);
  await expect(a.getByRole("group", { name: /Opponent hand/ })).toHaveCount(0);
  await expect(a.getByText(/^Energy:/)).toHaveCount(0);
  await expect(a.getByRole("heading", { name: /^Turn \d/ })).toHaveCount(0);
  await expect(
    a.getByRole("status").filter({ hasText: /connect|error/ }),
  ).toHaveCount(0);
  await expect(energy(a)).toBeVisible();
  await expect(commitButton(a)).toBeEnabled();
  await commitButton(a).focus();
  await expect(commitButton(a)).toBeFocused();
});

test("lane standings describe current leads and location inspection", async ({
  page,
  address,
}) => {
  const { full, guardian, smith } =
    await import("../src/client/stories/fixtures.ts");
  await page.routeWebSocket("**/ws", (socket) => {
    socket.send(JSON.stringify({ type: "welcome" }));
    socket.send(
      JSON.stringify({
        type: "state",
        view: {
          ...full,
          own: {
            ...full.own,
            lanes: [
              full.own.lanes[0] ?? [],
              [{ ...guardian, id: "second-lane-guardian" }],
              [],
            ],
          },
          opponent: {
            ...full.opponent,
            lanes: [
              full.opponent.lanes[0] ?? [],
              [],
              [{ ...smith, id: "third-lane-smith" }],
            ],
          },
        },
      }),
    );
  });
  await page.goto(address);
  await expect(
    page.getByText("Current standing: leading in 1 of 3 lanes", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Lane 2", exact: true }),
  ).toHaveAccessibleDescription("You lead");
  await expect(
    page.getByRole("region", { name: "Lane 3", exact: true }),
  ).toHaveAccessibleDescription("Opponent leads");
  const lane = page.getByRole("region", { name: "Lane 1", exact: true });
  await expect(lane).toHaveAccessibleDescription("Lane tied");
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const cards = lane.getByRole("article");
    await expect(cards).toHaveCount(8);
    for (const card of await cards.all()) {
      await expect(async () => {
        expect(
          await card.evaluate(
            (element) => element.scrollHeight <= element.clientHeight,
          ),
        ).toBe(true);
        const box = await card.boundingBox();
        if (!box) throw new Error("Card not visible");
        const group = await card.evaluate((element) =>
          (() => {
            const rect = element
              .closest('[role="group"]')
              ?.getBoundingClientRect();
            return rect
              ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
              : null;
          })(),
        );
        if (!group) throw new Error("Card group not visible");
        expect(box.x).toBeGreaterThanOrEqual(group.x);
        expect(box.y).toBeGreaterThanOrEqual(group.y);
        expect(box.x + box.width).toBeLessThanOrEqual(group.x + group.width);
        expect(box.y + box.height).toBeLessThanOrEqual(group.y + group.height);
        for (const stat of await card
          .getByRole("img")
          .filter({ hasText: /^\d+$/ })
          .all()) {
          const statBox = await stat.boundingBox();
          if (!statBox) throw new Error("Stat not visible");
          expect(statBox.x).toBeGreaterThanOrEqual(box.x);
          expect(statBox.x + statBox.width).toBeLessThanOrEqual(
            box.x + box.width,
          );
          expect(statBox.y + statBox.height).toBeLessThanOrEqual(
            box.y + box.height,
          );
        }
      }).toPass();
    }
  }
  await lane.getByRole("button", { name: "Lane 1", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    full.locations[0]?.text ?? "",
  );
});

test("unaffordable hand card stays inspectable and cannot be staged", async ({
  pair: [a],
}) => {
  const card = a
    .getByRole("region", { name: "Hand" })
    .getByRole("article")
    .filter({ hasText: /Cost [2-6]/ })
    .first();
  await expect(card).toHaveCSS("opacity", "0.55");
  await card.getByRole("button", { name: /^Inspect / }).click();
  await expect(a.getByRole("dialog")).toContainText(
    "No ability description available.",
  );
  for (let lane = 1; lane <= 3; lane++) {
    await expect(
      a.getByRole("button", {
        name: `Play selected card in lane ${String(lane)}`,
      }),
    ).toBeDisabled();
  }
  await expect(
    a.getByRole("region", { name: "Staged cards" }).getByRole("listitem"),
  ).toHaveCount(0);
});

for (const width of [390, 1440]) {
  test(`a lane-capacity lane locks its slots and refuses a card past the limit at ${String(width)}`, async ({
    page,
    address,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const capped = {
      id: "cave-of-the-sibyl",
      name: "Cave of the Sibyl",
      text: "Each player may reveal at most 2 cards here.",
      effect: { kind: "lane-capacity", limit: 2 },
    };
    const view = {
      player: 0,
      turn: 2,
      energy: 6,
      revealFirst: 0,
      locations: [capped, ...locations.slice(1)],
      phase: "planning",
      result: null,
      own: {
        hand: ["Asteron", "Thaleia", "Kallias"].map((name) => ({
          id: name.toLowerCase(),
          name,
          cost: 1,
          power: 2,
        })),
        staged: [],
        deckSize: 8,
        zones: noZones,
        committed: false,
        // One card already revealed in the limited lane counts toward its limit.
        lanes: [[{ id: "guard", name: "Guard", cost: 1, power: 2 }], [], []],
      },
      opponent: {
        handSize: 3,
        deckSize: 9,
        zones: noZones,
        committed: false,
        lanes: [[], [], []],
      },
      events: [],
    };
    await page.routeWebSocket("**/ws", (socket) => {
      socket.send(JSON.stringify({ type: "welcome" }));
      socket.onMessage((raw) => {
        const message: unknown = JSON.parse(String(raw));
        if (typeof message !== "object" || message === null) return;
        const staged =
          "plays" in message && Array.isArray(message.plays)
            ? message.plays
            : [];
        socket.send(
          JSON.stringify({
            type: "state",
            view: { ...view, own: { ...view.own, staged } },
          }),
        );
      });
    });
    await page.goto(address);
    await page.getByRole("button", { name: "Find match", exact: true }).click();
    const laneOne = page.getByRole("region", { name: "Lane 1", exact: true });
    const laneTwo = page.getByRole("region", { name: "Lane 2", exact: true });
    // Slots past the limit are visibly locked on both sides; other lanes are not.
    await expect(
      laneOne.getByRole("group", { name: "Your cards" }).getByText("Locked"),
    ).toHaveCount(2);
    await expect(
      laneOne
        .getByRole("group", { name: "Opponent cards" })
        .getByText("Locked"),
    ).toHaveCount(2);
    await expect(laneTwo.getByText("Locked")).toHaveCount(0);
    const playHere = (lane: number) =>
      page.getByRole("button", {
        name: `Play selected card in lane ${String(lane)}`,
        exact: true,
      });
    // Keyboard: the revealed card plus one staged card reach the limit.
    await expect(
      page.getByRole("button", {
        name: "Stage Asteron in lane 1",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Stage Asteron in lane 1", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("button", { name: "Unstage Asteron", exact: true }),
    ).toBeVisible();
    // The staged card fills the lane's last open slot, beside the revealed one.
    await expect(
      laneOne.getByRole("group", { name: "Your cards" }).getByRole("article"),
    ).toHaveText([/Guard/, /Asteron/]);
    const stageThaleia = page.getByRole("button", {
      name: "Stage Thaleia in lane 1",
      exact: true,
    });
    await expect(stageThaleia).toBeDisabled();
    await expect(stageThaleia).toHaveText("Lane 1 full");
    await expect(stageThaleia).toHaveAttribute("aria-description", "Lane full");
    await expect(
      page.getByRole("button", {
        name: "Stage Thaleia in lane 2",
        exact: true,
      }),
    ).toBeEnabled();
    // Tap-then-lane: with a card selected the full lane refuses and says why.
    await page
      .getByRole("button", { name: "Inspect Thaleia", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(playHere(1)).toBeDisabled();
    await expect(playHere(1)).toHaveText("Lane full");
    await expect(playHere(1)).toHaveAttribute("aria-description", "Lane full");
    await expect(playHere(2)).toBeEnabled();
    await page.keyboard.press("Escape");
    // Drag: dropping on the full lane is refused and the card stays in hand.
    const card = page
      .getByRole("region", { name: "Hand", exact: true })
      .getByRole("article", { name: "Thaleia", exact: true });
    const source = await card
      .getByRole("img", { name: "Art placeholder" })
      .boundingBox();
    const target = await laneOne
      .getByRole("group", { name: "Your cards" })
      .boundingBox();
    if (!source || !target) throw new Error("Missing drag endpoints");
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
    await expect(playHere(1)).toHaveText("Lane full");
    await page.mouse.up();
    await expect(page.getByRole("button", { name: /^Unstage/ })).toHaveCount(1);
    await expect(card).toBeVisible();
    // Unstaging reopens the slot.
    await page
      .getByRole("button", { name: "Unstage Asteron", exact: true })
      .click();
    await expect(stageThaleia).toBeEnabled();
  });
}

test.describe("power-per-card location", () => {
  test.use({ locationPool: "boosted" });
  test("both players see the same boosted total and the same final totals", async ({
    pair: [a, b],
  }) => {
    test.setTimeout(30_000);
    const boosted = a
      .getByRole("region", { name: /^Lane \d$/ })
      .filter({ hasText: "Forge Beneath Etna" });
    // The shipped rule text must be readable, not clipped by the lane header.
    for (const [page, size] of [
      [a, { width: 390, height: 844 }],
      [b, { width: 1440, height: 900 }],
    ] as const) {
      await page.setViewportSize(size);
      const rule = page
        .getByRole("region", { name: /^Lane \d$/ })
        .getByText("Each card you play here adds 2 power.", { exact: true });
      await expect(rule).toBeVisible();
      expect(
        await rule.evaluate((el) => el.scrollHeight <= el.clientHeight),
      ).toBe(true);
    }
    const laneName = (await boosted.getAttribute("aria-label")) ?? "";
    const lane = /^Lane (\d)$/.exec(laneName)?.[1];
    if (!lane) throw new Error("Missing boosted lane");
    await expect(
      b
        .getByRole("region", { name: `Lane ${lane}`, exact: true })
        .getByText("Forge Beneath Etna", { exact: true }),
    ).toBeVisible();
    const powers = new Map<Page, number[]>([
      [a, []],
      [b, []],
    ]);
    const total = (cards: readonly number[]) =>
      cards.reduce((sum, power) => sum + power + 2, 0);
    for (let turn = 1; turn <= 6; turn++) {
      for (const page of [a, b]) {
        await expect(
          page.getByRole("button", { name: `End turn ${String(turn)}/6` }),
        ).toBeVisible();
        const play = page
          .getByRole("button", {
            name: new RegExp(`^Stage .* in lane ${lane}$`),
          })
          .and(page.locator(":enabled"))
          .first();
        if (await play.count()) {
          const label = await play.getAttribute("aria-label");
          const name = /^Stage (.*) in lane \d$/.exec(label ?? "")?.[1];
          if (!name) throw new Error("Missing play label");
          const power = Number(
            (
              await page
                .getByRole("region", { name: "Hand", exact: true })
                .getByRole("article", { name, exact: true })
                .getByText(/^Power /)
                .innerText()
            ).replace("Power ", ""),
          );
          await play.press("Enter");
          powers.get(page)?.push(power);
        }
        await commitButton(page).click();
      }
      for (const page of [a, b])
        await expect(
          page.getByRole("button", {
            name: turn === 6 ? "View result" : `End turn ${String(turn + 1)}/6`,
            exact: true,
          }),
        ).toBeVisible();
      for (const [page, other] of [
        [a, b],
        [b, a],
      ] as const)
        await expect(
          page
            .getByRole("region", { name: `Lane ${lane}`, exact: true })
            .getByText(
              `Opponent total: ${String(total(powers.get(other) ?? []))} · Your total: ${String(total(powers.get(page) ?? []))}`,
              { exact: true },
            ),
        ).toBeVisible();
    }
    expect(
      (powers.get(a)?.length ?? 0) + (powers.get(b)?.length ?? 0),
    ).toBeGreaterThan(0);
    const finals = await Promise.all([a, b].map(resultTotals));
    expect(finals[0]).toEqual([finals[1]?.[1], finals[1]?.[0]]);
    expect([...(finals[0] ?? [])].sort()).toEqual(
      [total(powers.get(a) ?? []), total(powers.get(b) ?? [])].sort(),
    );
  });
});

test("player tags open player counts without moving the board", async ({
  page,
  address,
}) => {
  const { staging } = await import("../src/client/stories/fixtures.ts");
  const lostCard = (id: string) => ({
    id,
    name: `Lost ${id}`,
    cost: 2,
    power: 3,
  });
  await page.routeWebSocket("**/ws", (socket) => {
    socket.send(JSON.stringify({ type: "welcome" }));
    socket.send(
      JSON.stringify({
        type: "state",
        view: {
          ...staging,
          player: 1,
          own: {
            ...staging.own,
            zones: { ...staging.own.zones, banished: [lostCard("own-lost")] },
          },
          opponent: {
            ...staging.opponent,
            deckSize: 5,
            handSize: 2,
            zones: {
              destroyed: [lostCard("opp-lost-1"), lostCard("opp-lost-2")],
              discarded: [],
              banished: [],
            },
          },
        },
      }),
    );
  });
  await page.goto(address);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [label, deck, hand, counts, listed] of [
      [
        "Opponent · Player 1",
        5,
        2,
        { Destroyed: 2, Discarded: 0, Banished: 0 },
        ["Lost opp-lost-1", "Lost opp-lost-2"],
      ],
      [
        "You · Player 2",
        6,
        3,
        { Destroyed: 0, Discarded: 0, Banished: 1 },
        ["Lost own-lost"],
      ],
    ] satisfies [string, number, number, Record<string, number>, string[]][]) {
      const tag = page.getByRole("button", { name: new RegExp(`^${label}`) });
      await expect(tag).toBeInViewport();
      const lane = page.getByRole("region", { name: "Lane 1", exact: true });
      const before = await lane.boundingBox();
      await tag.focus();
      await tag.press("Enter");
      const sheet = page.getByRole("dialog", { name: label, exact: true });
      await expect(sheet).toBeVisible();
      await expect(
        sheet.getByText(`Deck: ${String(deck)}`, { exact: true }),
      ).toBeVisible();
      await expect(
        sheet.getByText(`Hand: ${String(hand)}`, { exact: true }),
      ).toBeVisible();
      // Every zone is face up: both players' lists open from the sheet.
      for (const [zone, count] of Object.entries(counts)) {
        const button = sheet.getByRole("button", {
          name: `${zone} (${String(count)})`,
          exact: true,
        });
        await expect(button).toBeEnabled();
        await button.click();
        const cards = sheet.getByRole("region", { name: zone, exact: true });
        if (count === 0) {
          await expect(cards.getByText("No cards.")).toBeVisible();
        } else {
          for (const name of listed)
            await expect(cards.getByText(name, { exact: false })).toBeVisible();
          await expect(cards.getByRole("listitem")).toHaveCount(count);
        }
        await button.click();
        await expect(cards).toHaveCount(0);
      }
      expect(await lane.boundingBox()).toEqual(before);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(tag).toBeFocused();
      await tag.click();
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await expect(sheet).toHaveCount(0);
    }
  }
});

test("a full zone scrolls inside the player sheet on a small phone", async ({
  page,
  address,
}) => {
  const { staging } = await import("../src/client/stories/fixtures.ts");
  const full = Array.from({ length: 12 }, (_, i) => ({
    id: `full-${String(i)}`,
    name: `Lost figure of the long road ${String(i)}`,
    cost: 2,
    power: 3,
  }));
  await page.routeWebSocket("**/ws", (socket) => {
    socket.send(JSON.stringify({ type: "welcome" }));
    socket.send(
      JSON.stringify({
        type: "state",
        view: {
          ...staging,
          opponent: {
            ...staging.opponent,
            zones: { destroyed: full, discarded: [], banished: [] },
          },
        },
      }),
    );
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(address);
  await page.getByRole("button", { name: /^Opponent/ }).click();
  const sheet = page.getByRole("dialog", { name: /^Opponent/ });
  await sheet.getByRole("button", { name: "Destroyed (12)" }).click();
  await expect(sheet.getByRole("listitem")).toHaveCount(12);
  // The list is taller than the viewport, so it must scroll inside the sheet
  // with the heading and zone buttons still on screen at the top.
  expect(await sheet.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await expect(sheet.getByRole("heading", { level: 2 })).toBeInViewport();
  await expect(
    sheet.getByRole("button", { name: "Banished (0)" }),
  ).toBeInViewport();
  const close = sheet.getByRole("button", { name: "Close", exact: true });
  await close.scrollIntoViewIfNeeded();
  await expect(close).toBeInViewport();
});
