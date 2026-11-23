import { test, expect } from "./support.ts";

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
