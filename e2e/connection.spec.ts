import { test as base, expect } from "@playwright/test";
import { startServer } from "../src/server/index.ts";
const test = base.extend<{ address: string }>({
  address: async ({ browserName }, use) => {
    if (browserName !== "chromium") throw new Error("Chromium required");
    const server = await startServer({ port: 0, clientDirectory: "dist" });
    try {
      await use(`http://localhost:${String(server.port)}`);
    } finally {
      server.close();
    }
  },
});
test("production page connects and reconnects after reload", async ({
  page,
  address,
}) => {
  await page.goto(address);
  await expect(page.getByRole("status")).toHaveText("connected");
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("connected");
});
test("stays connecting until a welcome arrives", async ({ page, address }) => {
  await page.routeWebSocket("**/ws", (socket) => {
    socket.onMessage(() => {
      /* The server intentionally withholds its welcome. */
    });
  });
  await page.goto(address);
  await expect(page.getByRole("status")).toHaveText("connecting");
});
test("malformed server message displays error", async ({ page, address }) => {
  await page.routeWebSocket("**/ws", (socket) => {
    socket.send("not JSON");
  });
  await page.goto(address);
  await expect(page.getByRole("status")).toHaveText("error");
});
test("socket closure displays error", async ({ page, address }) => {
  await page.routeWebSocket("**/ws", (socket) => {
    void socket.close();
  });
  await page.goto(address);
  await expect(page.getByRole("status")).toHaveText("error");
});
