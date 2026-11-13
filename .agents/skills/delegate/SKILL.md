---
name: delegate
description: >-
  Route work to a subagent or another model. Use before spawning any subagent, delegating a task,
  running work in parallel, or choosing a model, provider, or effort level for a task.
---

# Delegate

Owned by this repo. The single source of truth for **which model does what** and **how to hand work off**. Other skills say "subagent", "implementer", or "reviewer"; this skill turns that into a concrete provider, model, and effort.

## 1. Pick the tier

Spend in this order: **subscriptions first** (Claude and Codex are flat-rate, so unused allowance is waste), **DeepSeek for overflow and bulk** (pay-per-token, but pennies). Claude Opus is the scarcest allowance; keep it for judgement. Pick in one look: a wrong cheap pick costs one retry, which is cheaper than deliberating.

| Tier | The work | Primary | Fallback |
|---|---|---|---|
| **judge** | grilling, specs, architecture, final review, orchestrating other agents | Claude Opus 5.5 (usually the session itself) | stay in-session; ask the user |
| **explore** | find code, read docs, summarise; read-only | Claude Haiku 5.5 (native `Agent`, `Explore` type) | DeepSeek Flash |
| **implement** | a ticket with acceptance criteria and a command that proves it | Codex `gpt-6.1-sol`, effort `medium` | Claude Sonnet 5.5 |
| **review** | review a diff from the *other* model family | Codex `gpt-6.1-sol` `medium` for Claude-written work; Claude Sonnet 5.5 for Codex-written work | Codex `gpt-6.1-terra` `medium` |
| **grunt** | mechanical, fully specified: card data entry, boilerplate, fixtures, renames, lint-fix sweeps | DeepSeek Flash via OpenCode | Claude Haiku 5.5; Codex `gpt-6-luna` |
| **hard** | an implement attempt failed, or the problem is a gnarly algorithm | Codex `gpt-6.1-terra`, effort `max` | Codex `gpt-6-astra` (rare: strong but token-hungry, poor value) |

**Claude's cheap models out of usage?** Move explore/grunt to Codex `gpt-6.1-terra` `medium` or `gpt-6-luna`, then DeepSeek.

Why these picks (Scott's LLM Arena reading, 2026-11-13): `gpt-6-luna` at max sits slightly below DeepSeek v4.1 Flash; `gpt-6.1-terra` medium and `gpt-6.1-sol` medium both beat them; `terra` max edges `sol` medium at a higher token cost; `astra` is off the value chart. Scott rates `sol` medium as the best value.

## 2. Launch it

| Target | Tool |
|---|---|
| Claude model, no extra settings | native `Agent` with `model: haiku \| sonnet \| opus`, `run_in_background: false` |
| Codex, OpenCode, a Claude effort setting, or a separate checkout | T3 `delegate_task` |

`delegate_task` notes:
- Call `orchestrator_capabilities` once per thread before the first `delegate_task`. Copy model ids from it; the ids above are as of 2026-11-13.
- `target.providerInstanceId`: `codex`, `claudeAgent`, or `opencode`. Options: Codex `{reasoningEffort: "medium"}`, Claude `{effort: "high"}`.
- DeepSeek ids in OpenCode: `deepseek/deepseek-flash` (Scott's key) and `opencode/deepseek-v4.1-flash-free` (free; try it first for grunt work).
- `isolation: "worktree"` whenever the child edits files while anyone else is editing too, or the work should land as its own PR.
- Set `role` (`implementation`, `research`, `review`, `test`).

## 3. Write the brief

The child gets **only** the brief: no conversation, and non-Claude children get no `CLAUDE.md` hooks (they do read `AGENTS.md`). Include:

1. **Goal**: one sentence, in `GLOSSARY.md` vocabulary.
2. **Context pointers**: issue number, files, ADRs, prior commits. Point; don't paste.
3. **Scope**: files it may touch, and an explicit "leave everything else untouched" list when others are working nearby.
4. **Done when**: the exact command(s) that must pass (`pnpm test …`, `pnpm typecheck`, `pnpm lint`).
5. **Report back**: what changed, the command output, anything out of scope it noticed (noted, not fixed).

## 4. Verify the artifact

Trust artifacts, never self-reports. After every child: `git diff --stat` against what the brief allowed, then run the done-when command yourself. Out-of-scope edits get reverted, not negotiated.

On failure: retry once at the same tier with a sharper brief; then step up a tier (grunt → implement → hard).

## 5. Log it

After verifying, the orchestrator (never the child, to avoid merge conflicts) appends one row to [`docs/agents/delegation-log.md`](../../../docs/agents/delegation-log.md). `/retro` reads the log to retune the tier table above; this table is the only place routing changes.
