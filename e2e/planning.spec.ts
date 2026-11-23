import {
  noZones,
  locations,
  commitButton,
  energy,
  test,
  reachPlayableTurn,
  expect,
} from "./support.ts";

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

test("unaffordable hand card stays inspectable and cannot be staged", async ({
  pair: [a],
}) => {
  const card = a
    .getByRole("region", { name: "Hand" })
    .getByRole("article")
    .filter({ hasText: /Cost [2-6]/ })
    .first();
  await expect(card).toHaveCSS("opacity", "0.55");
  const ability = card.locator('[data-part="ability"]');
  const description = (await ability.count())
    ? await ability.innerText()
    : "No ability description available.";
  await card.getByRole("button", { name: /^Inspect / }).click();
  await expect(a.getByRole("dialog")).toContainText(description);
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
