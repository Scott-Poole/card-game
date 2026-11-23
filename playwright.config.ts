import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  // Each test starts its own server on a free port and opens its own browser contexts, so tests share
  // no state. The suite is bound by reveal playback and timers rather than CPU, so a few workers cut
  // wall-clock time without oversubscribing a 4-core GitHub runner or a dev machine.
  workers: 4,
  forbidOnly: !!process.env.CI,
  use: { browserName: "chromium" },
  timeout: 15000,
});
