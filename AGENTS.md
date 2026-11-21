# card-game

An original lane-based, simultaneous-turn strategy card game for the browser, served by an authoritative TypeScript game server over uWebSockets.js. Mechanics follow the lane-battler genre (lanes, simultaneous reveal, an energy curve, location effects); the content is ours. Cards are figures from Greek and Roman myth. Every card, location, name, ability, and visual is invented fresh, never carried over from an existing game.

The repo is equally a testbed for Scott's agent workflow: how work is planned, routed across models, verified, and improved. When a process step goes badly, fixing the process (a skill, a lint rule, a check) is in scope.

## Current state

One pnpm-managed ESM TypeScript package. Source areas: `src/rules` (shared constants, staging legality and lane totals; imports nothing), `src/engine` (match resolution, roster validation, seeded per-lane locations with effects, and off-board zones), `src/protocol` (wire messages and decoders), `src/server` (authoritative WebSocket host), and `src/client` (browser UI). Lint keeps engine and protocol independent of each other and server/client, restricts both to local imports, and forbids server↔client imports; only client may import styled-system.

The React client routes Home/Waiting/Match/Result screens, manages session state with Redux Toolkit, styles with Panda CSS, supports drag/tap/keyboard card play, animates with Motion, and has Storybook stories. The roster includes on-reveal abilities: self boosts, ally boosts, enemy weakening and destruction, with effects shown during reveal playback. The board shows each lane's location and effect, and the player-info sheet opens destroyed, discarded and banished zones. A finished match keeps the board on screen; its Result panel shows the winner, lanes won, each side's total power, and a Play again button back to Home, and a Playwright test drives that whole flow with two phone-sized browsers. The server draws decks from the authored roster (two cards per cost, 1 to 6), and a disconnect during planning ends the match as a forfeit. On the server, `join` from a player whose match has ended frees that seat so they can queue again. For player integrations and shared rule knowledge, read [ADR-0001: every player uses the protocol view](docs/adr/0001-players-use-the-protocol-view.md).

Node 26.13.1 is the current LTS; uWebSockets.js v20.71.0 ships the Node 26 ABI 147 binary. Versions are pinned in `.nvmrc` and `package.json`.

## Commands

- `pnpm check`: the full local gate, run with `CI=true` for parity with GitHub. It covers static checks, unit tests, regression suites for the repo's own scripts and skills, the Storybook and production builds, and Chromium browser tests. `scripts/gates.mjs` holds the exact ordered list.
- `pnpm install --frozen-lockfile` installs Husky hooks. Commits format staged files; pushes run the full check; run `pnpm check` before pushing too. GitHub repeats the same gate as independent verification.
- `pnpm fix`: format and lint auto-fix.
- Tests live beside source in `src/`; Vitest config has its own tooling typecheck. ESLint configuration is executed by the lint gate and is not typechecked.
- `pnpm dev`: Vite HMR and Node server watch mode, with a WebSocket proxy.
- `pnpm build`: build the React client into `dist`.
- `pnpm start`: serve `dist` and `/ws` together (`PORT` defaults to 4747).
- Agents can drive the running app with Playwright to verify UI work. `pnpm test:browser` tests the production build on a free port.
- `pnpm storybook`: run the component story explorer; `pnpm build-storybook`: build it for static hosting.
- Each gate has its own script in `package.json`.

## Working rules

- **Worktrees**: Scott's primary checkout (`/home/spoole/Projects/card-game`) is his to run, and it may sit many commits behind `origin/main`. To see what is on `main`, run the `read-main` skill's script and read the path it prints (a read-only view; write elsewhere); a read-only agent needs no worktree of its own or `pnpm install`. No agent edits files in the primary checkout, switches its branch, or runs `pnpm install` there; `git fetch` is fine. An interactive T3 thread that will edit files calls `t3_worktree_handoff` first, before any branch, edit or install. Subagents and delegated children that edit files get their own worktree (`isolation: "worktree"`, or `workspaceStrategy` on `t3_thread_launch`). T3 worktrees live under `~/.t3/worktrees/card-game/`; each needs its own `pnpm install --frozen-lockfile`. An unattended thread (`work-ticket`, planner) or a parent with delegated children removes its worktree once its work is done (PR merged, or abandoned), as the last command of its turn since the shell's directory goes with it: confirm `git status --porcelain` is empty, then `git worktree remove "$PWD"`. Interactive threads keep theirs until Scott says it is done. Leave the local branch; the guardrail blocks `git branch -D` and `land` explains why it stays. The `tick` sweeps up finished `ticket/` and `plan/` worktrees their owners missed.
- **Branch and PR**: every change lands on `main` through a PR. Use `gh` for all GitHub work. `gh pr edit` fails here with a "Projects (classic) is being deprecated" GraphQL error; edit PRs through REST instead: `gh api -X PATCH repos/Scott-Poole/card-game/pulls/<n> -F body=@<file>`. Pass long text to `gh`/`git` by file (`--body-file`, `-F`).
- **Landing**: opening a PR is rarely the last step. Once `validate` passes and the PR is open, run the `land` skill in the same turn: it reviews as the PR's risk demands, merges when the review is clean, fixes the findings when it is not, and brings Scott only direction calls nobody can settle. Escalation is the last resort; bias toward merging and course-correcting later. Stop at an open PR only when Scott says to or `land` itself stops (blocked review, escalation). History on `main` is linear: GitHub enforces PR-only, squash-merge-only (one commit per PR, titled with the PR title), no force push. Size PRs as one logical change, and write the PR title as a conventional commit.
- **Ticket automation**: a scheduled `tick` claims the oldest unblocked `ready-for-agent` ticket and launches one `work-ticket` thread, which implements, lands, and merges its own PR. When no ticket is ready, the tick launches a `plan` thread instead: one category per run, in rotation, filing fresh `ready-for-agent` tickets for later ticks. `ready-for-agent` means "an agent may take this unattended": leave it off a ticket, or assign it to someone, to hold it back. Caps and the off switch: the `tick` skill.
- **Records**: when writing status, findings, run records, or resolutions, follow [Where records live](docs/agents/issue-tracker.md#where-records-live).
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
