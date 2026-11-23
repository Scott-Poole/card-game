import { roster } from "../src/server/roster.ts";
import {
  unmodelledAbilities,
  stageExcept,
  commitButton,
  test,
  expect,
} from "./support.ts";
import type { Page } from "@playwright/test";

const destroyers = roster.filter(
  ({ card }) => card.ability?.effect.kind === "destroy-weakest-enemy",
);

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
        .getByRole("button", {
          name: stageExcept(unmodelledAbilities),
        })
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
        if (name === "Flora, Orchard's First Whisper")
          for (const prior of records.get(page) ?? [])
            if (prior.lane === Number(match[2])) prior.power += 1;
        records.get(page)?.push({
          name,
          power:
            Number(powerText.replace("Power ", "")) +
            (name === "Hermes, Keeper of Unsent Letters" ? 2 : 0),
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
  // By turn four the six drawn cards include an affordable non-destroyer.
  for (let turn = 1; turn < 4; turn++) {
    for (const page of [a, b]) await commitButton(page).click();
    for (const page of [a, b])
      await expect(
        page.getByRole("button", { name: `End turn ${String(turn + 1)}/6` }),
      ).toBeVisible();
  }
  for (const page of [a, b]) {
    await page
      .getByRole("button", {
        name: stageExcept(destroyers, "1"),
      })
      .and(page.locator(":enabled"))
      .first()
      .press("Enter");
    await commitButton(page).click();
  }
  const totals: string[] = [];
  for (const page of [a, b]) {
    await expect(
      page.getByRole("button", { name: "End turn 5/6" }),
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
