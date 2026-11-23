import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  // Keep the browser suite serial as it was before splitting it into topic files.
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: { browserName: "chromium" },
  timeout: 15000,
});
