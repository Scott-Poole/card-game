import {
  unmodelledAbilities,
  stageExcept,
  noZones,
  locations,
  commitButton,
  resultTotals,
  test,
  expect,
} from "./support.ts";
import type { Page } from "@playwright/test";

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
            name: stageExcept(unmodelledAbilities, lane),
          })
          // Keep this location-total scenario independent of enemy weakening and destruction.
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
          if (name === "Flora, Orchard's First Whisper")
            powers.set(
              page,
              (powers.get(page) ?? []).map((prior) => prior + 1),
            );
          powers
            .get(page)
            ?.push(
              power + (name === "Hermes, Keeper of Unsent Letters" ? 2 : 0),
            );
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
