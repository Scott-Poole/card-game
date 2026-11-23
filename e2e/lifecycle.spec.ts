import {
  commitButton,
  resultTotals,
  lanesWon,
  energy,
  test,
  expect,
} from "./support.ts";
import type { Page } from "@playwright/test";

// Welcome received: the action that needs a connection is enabled, no trouble indicator shown.
async function expectConnected(page: Page, action: string) {
  await expect(
    page.getByRole("button", { name: action, exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("status").filter({ hasText: /connect|error/ }),
  ).toHaveCount(0);
}

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

test.describe("forfeit with staged cards", () => {
  test.use({ abilities: true });
  test("forfeit returns staged cards to the finished board's hand", async ({
    pair: [a, b],
  }) => {
    const play = a
      .getByRole("button", { name: /^Stage .* in lane 1$/ })
      .and(a.locator(":enabled"))
      .first();
    const label = await play.getAttribute("aria-label");
    const name = /^Stage (.*) in lane 1$/.exec(label ?? "")?.[1];
    if (!name) throw new Error("Missing staged card name");
    const hand = a.getByRole("region", { name: "Hand", exact: true });
    await play.press("Enter");
    await expect(
      a.getByRole("button", { name: `Unstage ${name}`, exact: true }),
    ).toBeVisible();
    await expect(energy(a)).toHaveAttribute("aria-valuenow", "0");
    await expect(hand.getByRole("article", { name, exact: true })).toHaveCount(
      0,
    );
    await b.context().close();
    await expect(
      a.getByRole("heading", { name: "Match result" }),
    ).toBeVisible();
    await expect(a.getByLabel("Winner")).toHaveText("You win");
    await expect(
      a
        .getByRole("region", { name: "Staged cards", exact: true })
        .getByRole("listitem"),
    ).toHaveCount(0);
    await expect(a.getByRole("button", { name: /^Unstage / })).toHaveCount(0);
    await expect(energy(a)).toHaveAttribute("aria-valuenow", "1");
    await expect(
      hand.getByRole("article", { name, exact: true }),
    ).toBeVisible();
  });
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
