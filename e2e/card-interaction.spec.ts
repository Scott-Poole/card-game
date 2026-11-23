import {
  noZones,
  locations,
  commitButton,
  test,
  reachPlayableTurn,
  expect,
} from "./support.ts";

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
