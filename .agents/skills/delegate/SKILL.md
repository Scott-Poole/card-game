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
| **explore** | find code, read docs, summarise; read-only | Claude Haiku 5.5 | DeepSeek Flash |
| **implement** | a ticket with acceptance criteria and a command that proves it | Codex `gpt-6.1-sol`, effort `medium` | Claude Sonnet 5.5 |
| **review** | review a diff; **never the author's family** | Claude-written → Codex `gpt-6.1-sol` `medium`; Codex-written → Claude Sonnet 5.5 | Claude-written → Codex `gpt-6.1-terra` `medium`; Codex-written → DeepSeek Flash (a third family) |
| **grunt** | mechanical, fully specified: card data entry, boilerplate, fixtures, renames, lint-fix sweeps | DeepSeek Flash | Claude Haiku 5.5; Codex `gpt-6-luna` |
| **hard** | an implement attempt failed, or the problem is a gnarly algorithm | Codex `gpt-6.1-terra`, effort `max` | Codex `gpt-6-astra` (rare: strong but token-hungry, poor value) |

**Claude's cheap models out of usage?** Move explore/grunt to Codex `gpt-6.1-terra` `medium` or `gpt-6-luna`, then DeepSeek. **No other-family reviewer available?** Say so in the result; a same-family review is not a cross-review.

Why these picks (Scott's LLM Arena reading, 2026-11-13): `gpt-6-luna` at max sits slightly below DeepSeek v4.1 Flash; `gpt-6.1-terra` medium and `gpt-6.1-sol` medium both beat them; `terra` max edges `sol` medium at a higher token cost; `astra` is off the value chart. Scott rates `sol` medium as the best value.

## 2. Launch it

The launcher depends on **both** who you are and who the target is:

| You are | Target | Tool |
|---|---|---|
| Claude | Claude model, no extra settings, shared checkout | native `Agent` with `model: haiku \| sonnet \| opus`, `run_in_background: false` |
| anyone | anything else (other provider, effort setting, separate checkout) | T3 `delegate_task` |

`delegate_task` notes:
- Call `orchestrator_capabilities` once per thread before the first `delegate_task`. Copy model ids from it; the ids above are as of 2026-11-13.
- `target.providerInstanceId`: `codex`, `claudeAgent`, or `opencode` (DeepSeek: model `deepseek/deepseek-flash`, option `variant`: `low` for grunt work).
- Options: Codex `{reasoningEffort: "medium"}`, Claude `{effort: "high"}`, OpenCode `{variant: "low"}`.
- `isolation: "worktree"` whenever the child edits files while anyone else may be editing too, or the work should land as its own PR. Read-only children use `"shared"`.
- Set `role` (`implementation`, `research`, `review`, `test`).

**Before launching an editing child in a shared checkout**, record a baseline: `git rev-parse HEAD` and `git status --porcelain`. It's how step 4 tells the child's changes apart from anyone else's.

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
- Shared checkout: compare against the step-2 baseline.
- Then run the done-when command yourself in that checkout, at that head.

Out-of-scope changes the child clearly made (absent from the baseline, inside its checkout) get reverted. Anything you can't attribute stays put: ask the user before touching it.

On failure: retry once at the same tier with a sharper brief; then step up a tier (grunt → implement → hard).

## 5. Log it

After verifying, the orchestrator (never the child) appends one row to [`docs/agents/delegation-log.md`](../../../docs/agents/delegation-log.md) and commits it with whatever branch it's on: no separate PR, and never on `main` (it's PR-only). Inside a `land` run, `land` step 4 decides when and where review rows are committed. A `work-ticket` thread logs its own implement row there too: its review is the verification. `.gitattributes` gives the file `merge=union`, so concurrent appends merge cleanly when integrated locally. `/retro` reads the log to retune the tier table above; this table is the only place routing changes.
