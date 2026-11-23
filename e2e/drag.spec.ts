import {
  noZones,
  locations,
  commitButton,
  test,
  reachPlayableTurn,
  expect,
} from "./support.ts";

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
      await card
        .getByRole("img", { name: "Art placeholder" })
        .scrollIntoViewIfNeeded();
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
