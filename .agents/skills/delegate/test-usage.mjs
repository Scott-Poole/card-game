import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "usage-"));
try {
  const now = "2026-11-22T12:00:00Z";
  const fixture = {
    claude:
      "Current session: 15% used · resets Nov 22, 6:10am (America/Los_Angeles)\nCurrent week (all models): 10% used · resets Nov 23, 6am (America/Los_Angeles)",
    codex: {
      rateLimits: {
        primary: {
          usedPercent: 90,
          windowDurationMins: 300,
          resetsAt: 1795356000,
        },
        secondary: {
          usedPercent: 100,
          windowDurationMins: 10080,
          resetsAt: 1795804816,
        },
      },
      rateLimitResetCredits: {
        credits: [{ status: "available", expiresAt: 1796064250 }],
      },
    },
    opencode: "ok",
  };
  writeFileSync(join(temp, "fixture.json"), JSON.stringify(fixture));
  const env = {
    ...process.env,
    CARD_GAME_USAGE_FILE: join(temp, "usage.json"),
  };
  execFileSync(
    "node",
    [
      ".agents/skills/delegate/usage-probe.mjs",
      "--fixture",
      join(temp, "fixture.json"),
      "--now",
      now,
    ],
    { env },
  );
  const usage = JSON.parse(readFileSync(env.CARD_GAME_USAGE_FILE));
  assert.equal(usage.providers.claudeAgent.posture, "prefer");
  assert.equal(usage.providers.codex.posture, "out");
  assert.equal(usage.providers.opencode.posture, "neutral");
  assert.equal(usage.providers.codex.resetCredits.length, 1);
  fixture.claude = "unparseable";
  fixture.codex.rateLimits.secondary.usedPercent = 80;
  writeFileSync(join(temp, "fixture.json"), JSON.stringify(fixture));
  execFileSync(
    "node",
    [
      ".agents/skills/delegate/usage-probe.mjs",
      "--fixture",
      join(temp, "fixture.json"),
      "--now",
      now,
    ],
    { env },
  );
  const second = JSON.parse(readFileSync(env.CARD_GAME_USAGE_FILE));
  assert.equal(second.providers.claudeAgent.posture, "unknown");
  assert.equal(second.providers.codex.posture, "conserve");
  fixture.claude =
    "Current session: 50% used · resets Nov 22, 6:10am (America/Los_Angeles)\nCurrent week (all models): 10% used · resets Nov 28, 6am (America/Los_Angeles)\nCurrent week (Opus): 40% used · resets Nov 28, 6am (America/Los_Angeles)";
  fixture.opencode = "service unavailable";
  fixture.codex.rateLimitResetCredits.credits.push({
    status: "available",
    expiresAt: 1,
  });
  writeFileSync(join(temp, "fixture.json"), JSON.stringify(fixture));
  execFileSync(
    "node",
    [
      ".agents/skills/delegate/usage-probe.mjs",
      "--fixture",
      join(temp, "fixture.json"),
      "--now",
      now,
    ],
    { env },
  );
  const third = JSON.parse(readFileSync(env.CARD_GAME_USAGE_FILE));
  assert.equal(third.providers.claudeAgent.windows[2].usedPercent, 40);
  assert.equal(third.providers.claudeAgent.posture, "conserve");
  assert.equal(third.providers.opencode.posture, "out");
  assert.equal(third.providers.codex.resetCredits.length, 1);
  console.log("usage fixture tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
const routingTemp = mkdtempSync(join(tmpdir(), "usage-route-"));
try {
  const file = join(routingTemp, "usage.json");
  const env = { ...process.env, CARD_GAME_USAGE_FILE: file };
  const route = (...args) =>
    JSON.parse(
      execFileSync("bash", [".agents/skills/delegate/route.sh", ...args], {
        env,
      }),
    );
  writeFileSync(
    file,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      providers: {
        claudeAgent: { posture: "conserve" },
        codex: { posture: "prefer" },
      },
    }),
  );
  assert.equal(route("plan")[0].providerInstanceId, "codex");
  assert.equal(route("implementation-share"), 0.2);
  writeFileSync(
    file,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      providers: { claudeAgent: { posture: "out" } },
    }),
  );
  assert.equal(route("plan").length, 1);
  writeFileSync(
    file,
    JSON.stringify({
      fetchedAt: "2000-01-01",
      providers: { claudeAgent: { posture: "out" } },
    }),
  );
  assert.equal(route("plan")[0].providerInstanceId, "claudeAgent");
  assert.equal(route("plan", "--out", "claude")[0].providerInstanceId, "codex");
  console.log("usage routing tests passed");
} finally {
  rmSync(routingTemp, { recursive: true, force: true });
}
