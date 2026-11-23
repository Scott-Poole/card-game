import { commitButton, test, expect } from "./support.ts";
import type { Page } from "@playwright/test";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]) {
  test(`ability previews fit full lanes at ${String(viewport.width)}px`, async ({
    page,
    address,
  }) => {
    const { revealed, herald } =
      await import("../src/client/stories/fixtures.ts");
    const cards = (prefix: string) =>
      Array.from({ length: 4 }, (_, index) => ({
        ...herald,
        id: `${prefix}-${String(index)}`,
        power: 3,
        ability: {
          text: "On reveal, gather 2 power.",
          effect: { kind: "boost-self" as const, amount: 2 as const },
        },
      }));
    const view = {
      ...revealed,
      own: { ...revealed.own, lanes: [cards("own"), [], []] },
      opponent: { ...revealed.opponent, lanes: [cards("other"), [], []] },
    };
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.routeWebSocket("**/ws", (socket) => {
      socket.send(JSON.stringify({ type: "welcome" }));
      socket.send(JSON.stringify({ type: "state", view }));
    });
    await page.goto(address);
    const lane = page.getByRole("region", { name: "Lane 1", exact: true });
    await expect(lane.getByRole("article")).toHaveCount(8);
    await expect(async () => {
      const section = await lane.boundingBox();
      const header = await lane.locator("header").boundingBox();
      const opponent = await lane
        .getByRole("group", { name: "Opponent cards" })
        .boundingBox();
      const own = await lane
        .getByRole("group", { name: "Your cards" })
        .boundingBox();
      if (!section || !header || !opponent || !own)
        throw Error("Missing lane geometry");
      expect(opponent.y + opponent.height).toBeLessThanOrEqual(header.y + 1);
      expect(own.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      expect(own.y + own.height).toBeLessThanOrEqual(
        section.y + section.height + 1,
      );
      for (const card of await lane.getByRole("article").all()) {
        const bounds = await card.boundingBox();
        const text = await card.locator('[data-part="ability"]').boundingBox();
        if (!bounds || !text) throw Error("Missing ability geometry");
        expect(text.y + text.height).toBeLessThanOrEqual(
          bounds.y + bounds.height,
        );
      }
    }).toPass();
    await lane
      .getByRole("button", { name: `Inspect ${herald.name}`, exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "On reveal, gather 2 power.",
    );
  });
}

test.describe("authored abilities in a real match", () => {
  test.use({ abilities: true, controlledClock: true });
  test("two phones see power playback and inspect a destroyed enemy", async ({
    pair: [a, b],
  }) => {
    const hermes = "Hermes, Keeper of Unsent Letters";
    const artemis = "Artemis, Watcher of Dewpaths";
    const lane = (page: Page) =>
      page.getByRole("region", { name: "Lane 1", exact: true });
    for (const page of [a, b]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page
          .getByRole("region", { name: "Hand", exact: true })
          .getByRole("article", { name: hermes, exact: true }),
      ).toContainText("On reveal, gather 2 power.");
    }
    await b
      .getByRole("button", { name: `Stage ${hermes} in lane 1`, exact: true })
      .press("Enter");
    for (const page of [a, b])
      await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
    await commitButton(a).click();
    await commitButton(b).click();
    for (const page of [a, b])
      await expect(
        page.getByRole("button", { name: "Skip reveal", exact: true }),
      ).toBeVisible();
    for (const page of [a, b]) await page.clock.runFor(360);
    await expect(
      lane(a).getByText("Opponent total: 1 · Your total: 0", { exact: true }),
    ).toBeVisible();
    await expect(
      lane(b).getByText("Opponent total: 0 · Your total: 1", { exact: true }),
    ).toBeVisible();
    for (const page of [a, b]) await page.clock.runFor(360);
    await expect(
      lane(a).getByText("Opponent total: 3 · Your total: 0", { exact: true }),
    ).toBeVisible();
    await expect(
      lane(b).getByText("Opponent total: 0 · Your total: 3", { exact: true }),
    ).toBeVisible();
    for (const page of [a, b]) await page.clock.resume();
    for (let turn = 2; turn <= 3; turn++) {
      for (const page of [a, b]) {
        await expect(
          page.getByRole("button", {
            name: `End turn ${String(turn)}/6`,
            exact: true,
          }),
        ).toBeVisible();
        await commitButton(page).click();
      }
    }
    await expect(
      a.getByRole("button", { name: "End turn 4/6", exact: true }),
    ).toBeVisible();
    await a
      .getByRole("region", { name: "Hand", exact: true })
      .getByRole("button", { name: `Inspect ${artemis}`, exact: true })
      .click();
    await expect(
      a
        .getByRole("dialog")
        .getByText(
          "On reveal, destroy the weakest enemy already revealed in this lane.",
          { exact: true },
        ),
    ).toBeVisible();
    await a.keyboard.press("Escape");
    await a
      .getByRole("button", { name: `Stage ${artemis} in lane 1`, exact: true })
      .press("Enter");
    await expect(
      lane(a).getByRole("article", { name: artemis, exact: true }),
    ).toContainText(
      "On reveal, destroy the weakest enemy already revealed in this lane.",
    );
    for (const page of [a, b])
      await page.clock.pauseAt(new Date("2026-01-01T00:02:00Z"));
    await commitButton(a).click();
    await commitButton(b).click();
    for (const page of [a, b])
      await expect(
        page.getByRole("button", { name: "Skip reveal", exact: true }),
      ).toBeVisible();
    for (const page of [a, b]) await page.clock.runFor(360);
    await expect(
      lane(a).getByText("Opponent total: 3 · Your total: 7", { exact: true }),
    ).toBeVisible();
    await expect(
      lane(b).getByText("Opponent total: 7 · Your total: 3", { exact: true }),
    ).toBeVisible();
    for (const page of [a, b]) await page.clock.runFor(360);
    await expect(
      lane(a).getByText("Opponent total: 0 · Your total: 7", { exact: true }),
    ).toBeVisible();
    await expect(
      lane(b).getByText("Opponent total: 7 · Your total: 0", { exact: true }),
    ).toBeVisible();
    for (const page of [a, b]) await page.clock.resume();
    for (const [page, label, totals] of [
      [a, /^Opponent/, "Opponent total: 0 · Your total: 7"],
      [b, /^You · Player/, "Opponent total: 7 · Your total: 0"],
    ] as const) {
      await expect(
        page.getByRole("button", { name: "End turn 5/6", exact: true }),
      ).toBeVisible();
      await expect(lane(page).getByText(totals, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: label }).click();
      const sheet = page.getByRole("dialog");
      await sheet
        .getByRole("button", { name: "Destroyed (1)", exact: true })
        .click();
      await expect(
        sheet.getByRole("region", { name: "Destroyed", exact: true }),
      ).toContainText(hermes);
      await expect(sheet).toContainText("On reveal, gather 2 power.");
      await page.keyboard.press("Escape");
    }
  });
});
