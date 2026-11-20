import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  use: { browserName: "chromium" },
  timeout: 15000,
});
