# card-game

An original lane-based, simultaneous-turn strategy card game for the browser, served by an authoritative TypeScript game server over uWebSockets.js. Mechanics follow the lane-battler genre (lanes, simultaneous reveal, an energy curve, location effects); the content is ours. Cards are figures from Greek and Roman myth, with Creative Commons art tracked by license and attribution. Every card, location, name, ability, and visual is invented fresh, never carried over from an existing game.

The repo is equally a testbed for Scott's agent workflow: how work is planned, routed across models, verified, and improved. When a process step goes badly, fixing the process (a skill, a lint rule, a check) is in scope.

## Current state

One pnpm-managed ESM TypeScript package. Source lives in `src/{engine,protocol,server,client}`; lint enforces their import boundaries. Protocol decoders, the WebSocket server and a React connection-status client are implemented.

Node 26.13.1 is the current LTS; uWebSockets.js v20.71.0 ships the Node 26 ABI 147 binary. Versions are pinned in `.node-version` and `package.json`.

## Commands

- `pnpm check`: typecheck, lint, format check, unit tests, git guardrail, queue and boundary regression suites, production build and Chromium browser tests, with `CI=true` for parity with GitHub.
- `pnpm install --frozen-lockfile` installs Husky hooks. Commits format staged files; pushes run the full check; run `pnpm check` before pushing too. GitHub repeats the same gate as independent verification.
- `pnpm fix`: format and lint auto-fix.
- Tests live beside source in `src/`; Vitest config has its own tooling typecheck. ESLint configuration is executed by the lint gate and is not typechecked.
- `pnpm dev`: Vite HMR and Node server watch mode, with a WebSocket proxy.
- `pnpm build`: build the React client into `dist`.
- `pnpm start`: serve `dist` and `/ws` together (`PORT` defaults to 3000).
- Agents can drive the running app with Playwright to verify UI work. `pnpm test:browser` tests the production build on a free port.
- Each gate has its own script in `package.json`.

## Working rules

- **Branch and PR**: every change lands on `main` through a PR. Use `gh` for all GitHub work. `gh pr edit` fails here with a "Projects (classic) is being deprecated" GraphQL error; edit PRs through REST instead: `gh api -X PATCH repos/Scott-Poole/card-game/pulls/<n> -F body=@<file>`. Pass long text to `gh`/`git` by file (`--body-file`, `-F`).
- **Landing**: an open PR reaches `main` (or Scott) through the `land` skill. Agents merge whatever fits its policy without asking. GitHub enforces PR-only, merge-commit-only, no force push on `main`.
- **Ticket automation**: a scheduled `tick` claims the oldest unblocked `ready-for-agent` ticket and launches one `work-ticket` thread, which implements, lands, and merges its own PR. When no ticket is ready, the tick launches a `plan` thread instead: one category per run, in rotation, filing fresh `ready-for-agent` tickets for later ticks. `ready-for-agent` means "an agent may take this unattended": leave it off a ticket, or assign it to someone, to hold it back. Caps and the off switch: the `tick` skill.
- **Commits**: conventional commits, per the `commit` skill.
- **Validation**: follow .agents/skills/validate/SKILL.md before opening or updating a PR: full local checks and direct interaction with changed behavior, including browser testing for UI changes.
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
