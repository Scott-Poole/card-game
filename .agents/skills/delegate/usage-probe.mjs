import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { config, usagePath, posture } from "./usage.mjs";
const args = process.argv.slice(2);
const option = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const now = option("--now") ? Date.parse(option("--now")) : Date.now();
const fixtures = option("--fixture")
  ? JSON.parse(readFileSync(option("--fixture")))
  : null;
const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    timeout: config.timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
async function codex() {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const timer = setTimeout(
      () => finish(new Error("Codex meter timeout")),
      config.timeoutMs,
    );
    function finish(error, result) {
      clearTimeout(timer);
      child.kill();
      error ? reject(error) : resolve(result);
    }
    child.on("error", (error) => finish(error));
    child.on("exit", () => finish(new Error("Codex meter exited")));
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id === 2)
          finish(
            msg.error ? new Error(JSON.stringify(msg.error)) : null,
            msg.result,
          );
      } catch (error) {
        finish(error);
      }
    });
    for (const msg of [
      {
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "usage-probe", version: "1" } },
      },
      { method: "initialized" },
      { id: 2, method: "account/rateLimits/read" },
    ])
      child.stdin.write(JSON.stringify(msg) + "\n");
  });
}
// Claude prints local month/day times. Resolve them in the named IANA zone,
// rather than the timer host's timezone; a weekly reset can cross New Year.
function resetTime(text) {
  const match = text.match(
    /(\w{3}) (\d+), (\d+)(?::(\d+))?(am|pm) \(([^)]+)\)/,
  );
  if (!match) throw new Error("unknown Claude reset format");
  const [, month, day, hour, minute = "0", period, zone] = match;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const year = new Date(now).getUTCFullYear();
  for (const y of [year - 1, year, year + 1]) {
    const target = Date.UTC(
      y,
      months.indexOf(month),
      Number(day),
      (Number(hour) % 12) + (period === "pm" ? 12 : 0),
      Number(minute),
    );
    let time = target;
    for (let i = 0; i < 3; i++) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
          hourCycle: "h23",
        })
          .formatToParts(time)
          .map((p) => [p.type, p.value]),
      );
      const local = Date.UTC(
        +parts.year,
        +parts.month - 1,
        +parts.day,
        +parts.hour,
        +parts.minute,
        +parts.second,
      );
      time += target - local;
    }
    if (time > now && time - now <= 8 * 86400000)
      return new Date(time).toISOString();
  }
  throw new Error("Claude reset outside expected window");
}
const providers = {};
for (const provider of ["claudeAgent", "codex", "opencode"]) {
  try {
    const raw = fixtures
      ? fixtures[provider === "claudeAgent" ? "claude" : provider]
      : provider === "claudeAgent"
        ? run("claude", ["-p", "/usage"])
        : provider === "codex"
          ? await codex()
          : run("opencode", [
              "run",
              "-m",
              JSON.parse(
                readFileSync(new URL("./routing.json", import.meta.url)),
              ).aliases["flash.free"].model,
              "Reply with exactly: ok",
            ]);
    let windows = [],
      extra = {};
    if (provider === "claudeAgent") {
      for (const line of raw.split("\n")) {
        const m = line.match(
          /^Current (session|week \(all models\)|week \(.*opus.*\)): (\d+(?:\.\d+)?)% used.*resets (.*)$/i,
        );
        if (m)
          windows.push({
            name: m[1],
            usedPercent: +m[2],
            windowMinutes: m[1] === "session" ? 300 : 10080,
            resetsAt: resetTime(m[3]),
          });
      }
      if (
        !windows.some((w) => w.name === "session") ||
        !windows.some((w) => w.name === "week (all models)")
      )
        throw new Error("unparseable Claude /usage");
    } else if (provider === "codex") {
      const limits = raw.rateLimits;
      windows = ["primary", "secondary"]
        .filter((k) => limits?.[k])
        .map((k) => ({
          name: k,
          usedPercent: limits[k].usedPercent,
          windowMinutes: limits[k].windowDurationMins,
          resetsAt: new Date(limits[k].resetsAt * 1000).toISOString(),
        }));
      extra = {
        rateLimitReachedType: limits?.rateLimitReachedType ?? null,
        resetCredits: (raw.rateLimitResetCredits?.credits ?? []).filter(
          (c) => c.status === "available" && c.expiresAt * 1000 > now,
        ),
      };
    } else if (!/(?:^|\n)\s*ok\s*(?:\n|$)/i.test(raw))
      throw new Error("free Flash ping did not return ok");
    providers[provider] = {
      windows,
      ...extra,
      fetchedAt: new Date(now).toISOString(),
      posture:
        provider === "opencode"
          ? "neutral"
          : extra.rateLimitReachedType
            ? "out"
            : posture(
                windows.filter((w) => !/opus/i.test(w.name)),
                now,
              ),
    };
  } catch (error) {
    providers[provider] = {
      posture: provider === "opencode" ? "out" : "unknown",
      windows: [],
      fetchedAt: new Date(now).toISOString(),
      error:
        error.code === "ENOENT"
          ? "CLI missing"
          : provider === "claudeAgent"
            ? "Claude meter failed or unparseable"
            : provider === "codex"
              ? "Codex meter failed or unparseable"
              : "free Flash ping failed",
    };
  }
}
const warnings = [];
const capabilitiesPath = option("--capabilities");
try {
  if (capabilitiesPath) {
    const capabilities = JSON.parse(readFileSync(capabilitiesPath));
    if (
      !capabilities.fetchedAt ||
      now - Date.parse(capabilities.fetchedAt) >
        config.catalogStaleHours * 3600000
    )
      warnings.push("model catalog snapshot stale or undated");
    const routing = JSON.parse(
      readFileSync(new URL("./routing.json", import.meta.url)),
    );
    for (const alias of Object.values(routing.aliases)) {
      const provider = capabilities.providers.find(
        (p) => p.providerInstanceId === alias.providerInstanceId,
      );
      if (!provider?.models.some((m) => m.id === alias.model))
        warnings.push(`pinned model unavailable: ${alias.model}`);
      const family = alias.model.replace(/\d+/g, "#");
      const version = alias.model.match(/\d+/g)?.map(Number) ?? [];
      for (const model of provider?.models ?? []) {
        if (model.id.replace(/\d+/g, "#") !== family) continue;
        const candidate = model.id.match(/\d+/g)?.map(Number) ?? [];
        const first = version.findIndex((part, i) => part !== candidate[i]);
        if (first >= 0 && candidate[first] > version[first])
          warnings.push(`newer model ${model.id} than pinned ${alias.model}`);
      }
    }
  } else warnings.push("model catalog unknown: supply --capabilities snapshot");
} catch {
  warnings.push("model catalog unknown: invalid snapshot");
}
let sourceRevision = "installed-copy";
try {
  sourceRevision = run("git", [
    "-C",
    dirname(new URL(import.meta.url).pathname),
    "rev-parse",
    "HEAD",
  ]).trim();
} catch {}
const configHash = createHash("sha256")
  .update(JSON.stringify(config))
  .digest("hex");
const data = {
  sourceRevision,
  configHash,
  fetchedAt: new Date(now).toISOString(),
  providers,
  warnings,
};
const file = usagePath();
mkdirSync(dirname(file), { recursive: true });
const temp = `${file}.${process.pid}.tmp`;
writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
renameSync(temp, file);
const summary =
  Object.entries(providers)
    .map(
      ([p, v]) =>
        `${p}: ${v.posture}${v.error ? ` (${v.error})` : ""}${v.windows.length ? " " + v.windows.map((w) => `${w.name} ${w.usedPercent}% reset ${w.resetsAt}`).join(", ") : ""}${v.resetCredits?.length ? " credits " + v.resetCredits.map((c) => new Date(c.expiresAt * 1000).toISOString()).join(", ") : ""}`,
    )
    .join(" | ") + (warnings.length ? " | " + warnings.join("; ") : "");
console.log(summary);
if (args.includes("--mirror")) {
  const marker = "<!-- card-game-usage -->";
  const comments = run("gh", [
    "api",
    "--paginate",
    `repos/Scott-Poole/card-game/issues/${config.summaryIssue}/comments`,
    "--jq",
    ".[] | @json",
  ])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const login = run("gh", ["api", "user", "--jq", ".login"]).trim();
  const existing = comments.find(
    (c) => c.user.login === login && c.body.startsWith(marker),
  );
  const body = JSON.stringify({
    body: `${marker}\n${data.fetchedAt} | ${summary}`,
  });
  const saved = JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        "-X",
        existing ? "PATCH" : "POST",
        existing
          ? `repos/Scott-Poole/card-game/issues/comments/${existing.id}`
          : `repos/Scott-Poole/card-game/issues/${config.summaryIssue}/comments`,
        "--input",
        "-",
      ],
      {
        input: body,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: config.timeoutMs,
      },
    ),
  );
  if (!existing)
    execFileSync(
      "gh",
      [
        "api",
        "graphql",
        "-f",
        "query=mutation($id: ID!) { pinIssueComment(input: {issueCommentId: $id}) { clientMutationId } }",
        "-f",
        `id=${saved.node_id}`,
      ],
      { stdio: ["ignore", "ignore", "pipe"], timeout: config.timeoutMs },
    );
}
