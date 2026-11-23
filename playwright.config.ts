import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  // Each test starts its own server on a free port and opens its own browser contexts, so tests share
  // no state. The suite is bound by reveal playback and timers rather than CPU, so a few workers cut
  // wall-clock time without oversubscribing a 4-core GitHub runner or a dev machine.
  workers: 4,
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
