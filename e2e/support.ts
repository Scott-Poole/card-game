import { roster } from "../src/server/roster.ts";
import type { Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Existing scoring scenarios model the two original friendly boosts. Select
// other cards from authored effects rather than maintaining a name blacklist.
export const unmodelledAbilities = roster.filter(
  ({ card }) =>
    card.ability &&
    card.id !== "hermes-letterkeeper" &&
    card.id !== "flora-orchardwhisper",
);
export function stageExcept(entries: typeof roster, lane = "\\d") {
  const names = entries
    .map(({ card }) => card.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`^Stage (?!(?:${names}) in lane )(.*) in lane ${lane}$`);
}

export const noZones = { destroyed: [], discarded: [], banished: [] };
export const locations = ["Place A", "Place B", "Place C"].map(
  (name, index) => ({
    id: `place-${String(index)}`,
    name,
    text: "No effect for now.",
    effect: { kind: "none" },
  }),
);
export const commitButton = (page: Page) =>
  page.getByRole("button", { name: /^End turn \d+\/6$/ });
// The Result panel's totals as [yours, opponent's], and its lanes-won counts.
export async function resultTotals(page: Page) {
  const text = await page
    .getByRole("region", { name: "Match result" })
    .getByText(/^Total power:/)
    .innerText();
  const found = /^Total power: You (\d+) · Opponent (\d+)$/.exec(text);
  if (!found) throw new Error(`Unexpected totals: ${text}`);
  return [Number(found[1]), Number(found[2])] as const;
}
export async function lanesWon(page: Page) {
  const text = await page
    .getByRole("region", { name: "Match result" })
    .getByText(/^Lanes won:/)
    .innerText();
  const found = /^Lanes won: You (\d) · Opponent (\d)$/.exec(text);
  if (!found) throw new Error(`Unexpected lanes won: ${text}`);
  return [Number(found[1]), Number(found[2])] as const;
}
export const energy = (page: Page) =>
  page.getByRole("meter", { name: "Energy remaining" });
export const test = base.extend<{
  address: string;
  pair: readonly [Page, Page];
  controlledClock: boolean;
  abilities: boolean;
  // "plain" (default, so totals equal printed power) and "boosted" pin the
  // pool through e2e/server.ts; "shipped" is the real random pool.
  locationPool: "shipped" | "plain" | "boosted";
}>({
  abilities: [false, { option: true }],
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
  address: async ({ browserName, locationPool, abilities }, use) => {
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
          E2E_ABILITIES: String(abilities),
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
export async function reachPlayableTurn(a: Page, b: Page) {
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

export { expect };
