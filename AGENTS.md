# card-game

An original lane-based, simultaneous-turn strategy card game for the browser, served by an authoritative TypeScript game server over uWebSockets.js. Cards, locations, names, and art are our own.

The repo is equally a testbed for Scott's agent workflow: how work is planned, routed across models, verified, and improved. When a process step goes badly, fixing the process (a skill, a lint rule, a check) is in scope.

## Current state

As of 2026-11-13, the root `*.ts` files and `game/` are a 2025 prototype that does not compile. Treat it as reference for intent only; the tooling reset (phase 1) replaces it with a pnpm workspace, and new code goes there.

## Working rules

- **Branch and PR**: every change lands on `main` through a PR. Use `gh` for all GitHub work. `gh pr edit` fails here with a "Projects (classic) is being deprecated" GraphQL error; edit PRs through REST instead: `gh api -X PATCH repos/Scott-Poole/card-game/pulls/<n> -F body=@<file>`. Pass long text to `gh`/`git` by file (`--body-file`, `-F`).
- **Landing**: an open PR reaches `main` (or Scott) through the `land` skill. Agents merge whatever fits its policy without asking. GitHub enforces PR-only, merge-commit-only, no force push on `main`.
- **Ticket automation**: a scheduled `tick` claims the oldest unblocked `ready-for-agent` ticket and launches one `work-ticket` thread, which implements, lands, and merges its own PR. `ready-for-agent` means "an agent may take this unattended": leave it off a ticket, or assign it to someone, to hold it back. Caps and the off switch: the `tick` skill.
- **Commits**: conventional commits, per the `commit` skill.
- **Prove it works**: claim done only with command output (tests, typecheck, lint, `git diff --stat`). A subagent's report is a claim, not evidence.
- **Delegation**: before spawning any subagent or handing work to another model, load the `delegate` skill. It owns model routing.

## Skills

- `.agents/skills/` is the one skill directory; `.claude/skills` symlinks to it, so Claude Code, Codex, and OpenCode share the same set.
- `skills-lock.json` lists skills tracked from upstream (refresh with `npx skills update`). Once we tailor a skill, we remove it from the lock and it's ours.
- Unsure which flow fits? `/ask-matt` maps them: grill → spec → tickets → implement (TDD) → review → retro.

## Agent skills

### Issue tracker

GitHub Issues on `Scott-Poole/card-game` via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the root, created lazily. See `docs/agents/domain.md`.
