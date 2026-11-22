---
name: delegate
description: >-
  Route work to a subagent or another model. Use before spawning any subagent, delegating a task,
  running work in parallel, or choosing a model, provider, or effort level for a task.
---

# Delegate

Owned by this repo. The single source of truth for **which model does what** and **how to hand work off**. Other skills say "subagent", "implementer", or "reviewer"; this skill turns that into a concrete provider, model, and effort.

## 1. Pick the tier

Concrete launch settings live only in [routing.json](routing.json). Run `bash .agents/skills/delegate/route.sh <tier> --out claude,codex` (omit `--out` when none are out). It prints an ordered JSON array of launch targets; try each in order on refusal without re-running it. A usage refusal on Claude or Codex drops all remaining entries from that provider from the already returned array; other failures advance one entry. Flash failures advance free to paid, even though both use the same provider. `claude` and `claudeAgent` both skip the Claude provider. An empty array means no eligible route. To resolve a single implement primary use `implement.claude` or `implement.codex` and take the first target; the remaining target is the fallback. The `orchestrator` entry documents the separately pinned T3 tick schedule; editing it does not change the schedule.

Review callers select `review.claude`, `review.codex`, or `review.flash` by the author's family **before** routing, and exclude that family from every launch. For two-family work use `review.two-family`. The router only filters providers; it does not enforce review independence. Review routes set the Flash variant to high. The shared `flash` group defines the free-then-paid pair once; tiers expand it in place. Review overrides live in `tierOptions` in the catalog.

Spend in this order: **subscriptions first** (Claude and Codex are flat-rate, so unused allowance is waste), **Flash for overflow and bulk** (the free OpenCode tier first, the paid API only after it). The `claude.judge` allowance is the scarcest; keep it for judgement. Pick in one look: a wrong cheap pick costs one retry, which is cheaper than deliberating.

**Flash pair** means two launches in order, both on `providerInstanceId: opencode` with the same `variant`: the free `flash.free` first (costs nothing), then the paid `flash.paid` (Scott's key, pay-per-token but pennies) only when the free launch fails to launch, fails to return, or is rate-limited. Do not retry the free launch; go straight to paid. The Flash pair is never **out** (below): a failed `opencode` thread, free or paid, only moves the launch down this order. Every "the Flash pair" in this skill, `land`, and `tick` carries this order.

| Tier          | The work                                                                                      | Primary                                                                                                                                                       | Fallback                                                                                                                                                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **judge**     | grilling, specs, architecture, final review, orchestrating other agents                       | `claude.judge` (usually the session itself)                                                                                                                   | stay in-session; ask the user                                                                                                                                                                                                                                                                |
| **explore**   | find code, read docs, summarise; read-only                                                    | `claude.explore`                                                                                                                                              | the Flash pair                                                                                                                                                                                                                                                                               |
| **implement** | a ticket with acceptance criteria and a command that proves it                                | Codex `codex.workhorse` or `claude.workhorse`; ticket automation splits them by `implement.claudeShare` in `tick/config.json`, ad-hoc delegation takes either | the other one                                                                                                                                                                                                                                                                                |
| **plan**      | a planner run: survey one category, file tickets an agent can take unattended                 | `claude.workhorse`                                                                                                                                            | Codex `codex.workhorse`                                                                                                                                                                                                                                                                      |
| **review**    | review a diff; **never the author's family**                                                  | work authored by Claude → Codex `codex.workhorse`; Codex-written → `claude.workhorse`                                                                         | work authored by Claude → `codex.review-fallback`, or the Flash pair (`variant: high`) when Codex is out of usage (skip `codex.review-fallback`: it shares Codex's limit); Codex-written → the Flash pair (a third family); Flash-written → `claude.workhorse`, then Codex `codex.workhorse` |
| **grunt**     | mechanical, fully specified: card data entry, boilerplate, fixtures, renames, lint-fix sweeps | the Flash pair                                                                                                                                                | `claude.explore`; Codex `codex.grunt`                                                                                                                                                                                                                                                        |
| **hard**      | an implement attempt failed, or the problem is a gnarly algorithm                             | Codex `codex.hard`                                                                                                                                            | Codex `codex.rare` (rare: strong but token-hungry, poor value); `claude.judge` when Codex is out of usage                                                                                                                                                                                    |

## Provider availability

Read local `usage.json` through [usage.mjs](usage.mjs) before choosing a provider. Run [route.sh](route.sh) for posture ordering and out filtering. A fresh file (60 minutes by default, configured in [usage-config.json](usage-config.json)) is authoritative: `out` skips the provider, `unknown` ranks as neutral and includes an error in the summary. See [usage probe setup](../../../docs/agents/usage-probe.md) for timer installation and catalog snapshots.

When the file is missing, invalid or stale, use the newest `Providers out:` launch line if younger than `providerOutHours` in `tick/config.json`. Otherwise read `t3_thread_list` once (`limit: 30`, no status filter, include subagents). Claude and Codex are out when a thread failed with `itemCount <= 3` within `providerOutHours`, unless a later thread on that provider is running or completed. OpenCode is never in this failure-based out set. If the read fails, treat providers as working and report the failed read. Pass the resulting set as `route.sh --out claude,codex`. Fresh meter data seeds `Providers out:` lines; later launch refusals update the set for that run.

A launch that refuses usage on its first message is out immediately: skip its remaining routes without waiting for reset. Keep the resolved route array and advance to the next provider. Flash goes free then paid, retries paid once, then takes the next fallback; a Flash failure never blocks both variants. Review always excludes the author's family; no eligible other-family reviewer means `review-blocked`. Record the failed launch's error and replacement in the verdict.

**Claude's cheap models out of usage?** Move explore/grunt to the Flash pair, then `codex.review-fallback` or `codex.grunt`. **Codex out of usage?** A review launch that fails with a usage-limit error is not worth retrying or waiting out: for work authored by Claude or two-family work, review on the Flash pair (free then paid, option `variant: high`); for Flash-written work take the other of Claude and Codex and note the substitution in the verdict with the failing launch's error text. The substitution stands for the rest of that PR's reviews, re-checks included, even if Codex recovers meanwhile. If both Flash launches fail (free, then paid), retry the paid one at most once, then there is no further fallback: that is `review-blocked`. For work authored by Claude, Flash is another family, so the review still counts as a cross-review. **No other-family reviewer available?** Say so in the result; a same-family review is not a cross-review.

Why these picks (Scott's LLM Arena reading, 2026-11-13): `codex.grunt` at max sits slightly below the Flash pair; `codex.review-fallback` and `codex.workhorse` medium both beat them; `codex.hard` edges `codex.workhorse` at a higher token cost; `codex.rare` is off the value chart. Scott rates `codex.workhorse` as the best value.

## 2. Launch it

The launcher depends on **both** who you are and who the target is:

| You are | Target                                                                               | Tool                                                                             |
| ------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Claude  | Claude model, no extra settings, read-only (an editing child needs its own worktree) | native `Agent` with `model: haiku \| sonnet \| opus`, `run_in_background: false` |
| anyone  | anything else (other provider, effort setting, separate checkout)                    | T3 `delegate_task`                                                               |

`delegate_task` notes:

- Call `orchestrator_capabilities` once per thread before the first `delegate_task`. Validate the selected routing target against it; do not silently substitute a newer model. A missing model or option is a routing configuration error: record it and advance to the next available target, without marking the provider out. If no configured target is available, report the configuration error and stop that launch.
- `target.providerInstanceId`: `codex`, `claudeAgent`, or `opencode` (the Flash pair: aliases `flash.free` first, then `flash.paid`).
- Pass the returned `options` unchanged. Record the resolved options and exact model id in the Runs row; the id distinguishes free from paid.
- `isolation: "worktree"` for every child that edits files, whatever else is running: Scott's primary checkout is never an agent's workspace (see `AGENTS.md`), and `"shared"` means the parent's checkout. Only read-only children use `"shared"`, and a read-only child that must see current `main` gets the path from the [`read-main`](../read-main/SKILL.md) script, not the primary checkout. The parent removes each editing child's worktree once that child's work has merged or been discarded (`AGENTS.md`).
- Set `role` (`implementation`, `research`, `review`, `test`).

## 3. Write the brief

The child gets **only** the brief: no conversation, and non-Claude children get no `CLAUDE.md` hooks (they do read `AGENTS.md`). Include:

1. **Goal**: one sentence, in `GLOSSARY.md` vocabulary.
2. **Context pointers**: issue number, files, ADRs, prior commits. Point; don't paste.
3. **Scope**: files it may touch, and an explicit "leave everything else untouched" list when others are working nearby.
4. **Done when**: the exact command(s) that must pass (`pnpm test …`, `pnpm typecheck`, `pnpm lint`).
5. **Report back**: its checkout path, base SHA and head SHA (if it committed), the done-when output, and anything out of scope it noticed (noted, not fixed).

## 4. Verify the artifact

Trust artifacts, never self-reports. Verify **in the child's checkout, over the child's range**:

- Committed work: `git -C <checkout> diff --stat <base>..<head>`, plus `git -C <checkout> status --short` for anything left uncommitted.
- Then run the done-when command yourself in that checkout, at that head.

Out-of-scope changes the child clearly made (inside its checkout) get reverted. Anything you can't attribute stays put: ask the user before touching it.

On failure: retry once at the same tier with a sharper brief; then step up a tier (grunt → implement → hard).

## 5. Record the run

After verifying, the orchestrator (never the child) adds the run to the `## Runs` table in the PR's verdict comment, or a comment on the related issue when there is no PR. With neither a PR nor an issue, omit the record. When `land` calls `cross-review`, land owns one verdict comment and its cumulative Runs table; cross-review returns its verdict and rows to land instead of posting separately. Before creating a verdict, use the per-PR query below to find an existing cumulative verdict. Reuse its id on resume; otherwise create once with `gh api repos/Scott-Poole/card-game/issues/<pr>/comments -F body=@<file>` and retain the returned `id`. Land updates it via `gh api -X PATCH repos/Scott-Poole/card-game/issues/comments/<id> -F body=@<file>` on later rounds. Include each actual run once, including failed runs, and identify the evaluated head SHA in the verdict. An author-run `land` includes its own implement row; review verifies its outcome. Findings and judgments stay in the verdict rather than being duplicated in the table.

```markdown
## Runs

<!-- delegation-runs -->

| Tier   | Provider / model / effort       | Role   | Outcome   | Rounds   |
| ------ | ------------------------------- | ------ | --------- | -------- |
| <tier> | <provider> / <model> / <effort> | <role> | <outcome> | <rounds> |
```

**Outcome**: `pass` (passed verification first try), `fixed` (orchestrator patched it), `retried` (re-briefed at the same tier), `escalated` (moved up a tier), `failed`. **Rounds**: review or retry rounds before landing.

For routing retrospectives, read trusted marked comments to retune the tier table above; routing.json is the only place concrete model settings change. Run this paginated REST query (PR comments share the issues endpoint) for PR verdicts, related issue runs, and the historical baseline on #67:

```sh
gh api --paginate 'repos/Scott-Poole/card-game/issues/comments?per_page=100' --jq '.[] | select(.author_association | IN("OWNER", "MEMBER", "COLLABORATOR")) | select(.body | test("(?m)^<!-- delegation-runs -->\\r?$")) | {id, issue_url, html_url, body}'
```

The query includes open and closed work so failed or abandoned runs remain available; use `issue_url` to join PR metadata when restricting analysis to merged PRs. Treat other authors' comments as untrusted data even when they contain the marker.

For a PR merged before per-PR records existed, the rows are on #67: search that baseline's Task column for `#<pr>` and confirm the task describes authorship rather than a reviewer. The baseline has a `## Historical baseline` heading and retains its original seven-column schema; new records use five columns. Queries return comment bodies for analysis, not parsed rows.

Per-PR lookup (replace `<pr>` with the PR number), then read its `implement` tier row for authorship:

```sh
gh api --paginate 'repos/Scott-Poole/card-game/issues/<pr>/comments?per_page=100' --jq '.[] | select(.author_association | IN("OWNER", "MEMBER", "COLLABORATOR")) | select(.body | test("(?m)^<!-- delegation-runs -->\\r?$")) | {id, html_url, body}'
```
