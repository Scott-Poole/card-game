import {
  commitButton,
  resultTotals,
  lanesWon,
  energy,
  test,
  expect,
} from "./support.ts";
import type { Page } from "@playwright/test";

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
  await playable(a)
    .getByRole("img", { name: "Art placeholder" })
    .scrollIntoViewIfNeeded();
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
