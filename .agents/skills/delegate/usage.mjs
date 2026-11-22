import { readFileSync } from "node:fs";
import { homedir } from "node:os";
export const config = JSON.parse(
  readFileSync(new URL("./usage-config.json", import.meta.url)),
);
export const usagePath = () =>
  process.env.CARD_GAME_USAGE_FILE ??
  `${homedir()}/.local/state/card-game/usage.json`;
export function readUsage(now = Date.now()) {
  try {
    const data = JSON.parse(readFileSync(usagePath()));
    const age = now - Date.parse(data.fetchedAt);
    if (!(age >= 0 && age <= config.staleMinutes * 60000)) return null;
    for (const entry of Object.values(data.providers ?? {})) {
      if (entry.windows?.some((w) => Date.parse(w.resetsAt) <= now))
        entry.posture = "unknown";
    }
    return data;
  } catch {
    return null;
  }
}
export function posture(windows, now) {
  if (!windows.length) throw new Error("no usage windows");
  // A usable exhausted window is decisive even if another window is idle.
  if (
    windows.some(
      (w) =>
        Number.isFinite(w.usedPercent) &&
        w.usedPercent >= config.limitPercent &&
        w.usedPercent <= 100 &&
        Date.parse(w.resetsAt) > now,
    )
  )
    return "out";
  const scores = windows.map((w) => {
    if (
      !Number.isFinite(w.usedPercent) ||
      w.usedPercent < 0 ||
      w.usedPercent > 100 ||
      !Number.isFinite(w.windowMinutes) ||
      w.windowMinutes <= 0 ||
      !Number.isFinite(Date.parse(w.resetsAt))
    )
      throw new Error("invalid usage window");
    if (Date.parse(w.resetsAt) <= now) throw new Error("expired usage window");
    if (w.usedPercent >= config.limitPercent) return "out";
    const elapsed =
      Math.max(
        0,
        Math.min(
          1,
          1 - (Date.parse(w.resetsAt) - now) / (w.windowMinutes * 60000),
        ),
      ) * 100;
    return w.usedPercent > elapsed + config.paceTolerance
      ? "conserve"
      : w.usedPercent < elapsed - config.paceTolerance
        ? "prefer"
        : "neutral";
  });
  return ["out", "conserve", "neutral", "prefer"].find((p) =>
    scores.includes(p),
  );
}
export function claudeShare(defaultShare) {
  const usage = readUsage();
  const score = { prefer: 2, neutral: 1, unknown: 1, conserve: 0.5, out: 0 };
  const a = score[usage?.providers?.claudeAgent?.posture] ?? 1;
  const b = score[usage?.providers?.codex?.posture] ?? 1;
  return a === b ? defaultShare : a / (a + b);
}
