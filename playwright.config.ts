import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  // Keep the browser suite serial as it was before splitting it into topic files.
  workers: 1,
  forbidOnly: !!process.env.CI,
  // CI keeps failure evidence: a trace per failing test plus an HTML report that
  // check.yml uploads. No retries, so a flaky test fails the run instead of hiding.
  retries: 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: { browserName: "chromium", trace: "retain-on-failure" },
  timeout: 15000,
});
