# Usage probe

The OS runs `.agents/skills/delegate/usage-probe.mjs`; no scheduled agent or paid model call is needed. Claude `/usage` and Codex app-server read account meters. Only the OpenCode free Flash ping invokes a model. Errors become unknown (neutral routing), except a failed free ping makes OpenCode out. Each reading has fetched-at, window length, percent and reset. Any nonzero Opus weekly line is retained as its own window and participates in the most restrictive posture.

Posture compares percent used to percent of the window elapsed: within 15 percentage points is neutral, below is prefer, above is conserve, and 100% is out. The most restrictive window wins. All thresholds and timeouts live in `usage-config.json`. Expired windows are unknown. Unexpired available Codex reset credits include expiry times. No automatic reset is spent.

## Install and pause

Use a persistent checkout that you own (not an unattended ticket worktree). Install the pinned Node version and ensure `claude`, `codex`, `opencode` and authenticated `gh` are in the timer's PATH. Save an unwrapped `orchestrator_capabilities` response as `~/.local/state/card-game/capabilities.json`. Refresh it when T3 models change: the probe compares every pin, reports unavailable pins and newer numeric versions in the same family, and never edits routing.json. Without a snapshot it explicitly reports the catalog unknown.

Create `~/.config/systemd/user/card-game-usage.service`, replacing the absolute checkout and Node paths:

```ini
[Unit]
Description=Card game provider usage
[Service]
Type=oneshot
Environment=PATH=/home/spoole/.nvm/versions/node/v26.13.1/bin:/home/spoole/.local/bin:/usr/bin:/bin
ExecStart=/absolute/node /persistent/checkout/.agents/skills/delegate/usage-probe.mjs --mirror --capabilities /home/spoole/.local/state/card-game/capabilities.json
```

Create `~/.config/systemd/user/card-game-usage.timer`:

```ini
[Unit]
Description=Refresh provider usage every 20 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=20min
Persistent=true
[Install]
WantedBy=timers.target
```

Run `systemctl --user daemon-reload` and `systemctl --user enable --now card-game-usage.timer`. Pause with `systemctl --user stop card-game-usage.timer`; disable with `systemctl --user disable --now card-game-usage.timer`. Inspect failures with `journalctl --user -u card-game-usage.service`. The stable, marked summary comment lives on the configured issue; the probe pins it through GitHub GraphQL for visibility. Each run patches that same comment instead of creating a history of meter readings.

## Test

Run `node .agents/skills/delegate/test-usage.mjs` for fixture and routing checks. Run the probe manually with `--mirror --capabilities <snapshot>` to test the live boundary. `--fixture <json>` supplies recorded Claude text, Codex rate-limit result and OpenCode text; `--now <ISO-time>` fixes time. Set `CARD_GAME_USAGE_FILE` to isolate state (default `~/.local/state/card-game/usage.json`). Writes are atomic. Meter data never includes account ids or raw CLI logs.

`route.sh implementation-share` derives the implementation share from posture weights (prefer 2, neutral/unknown 1, conserve 0.5, out 0); equal weights keep the configured default. Every tier is stably ordered prefer, neutral, conserve, with out removed; existing failure-derived `--out` exclusions still apply. Stale state leaves route order unchanged so callers apply delegate's fallback rule.
