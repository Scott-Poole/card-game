---
name: land
description: >-
  Take an open PR to merged, or to Scott: classify its risk, review as the class demands, then
  merge or escalate. Use when a PR is ready, when asked to land, merge, or ship a PR, for the
  PR-review automation, or for a merge audit.
---

# Land

Owned by this repo. Scott's policy: **trivial** PRs merge without review and get audited later; **significant** PRs merge on agent consensus after a cross-family review; Scott hears only about **direction** decisions nobody can settle logically. Agents decide every merge that fits the policy without asking.

`main` is protected on GitHub: PR required, no force push or deletion, merge commits only.

## 1. Read the PR

```sh
gh pr view <n> --json title,body,headRefName,baseRefName,commits,files,additions,deletions
gh pr diff <n> --name-only
gh pr checks <n>          # once CI exists, every check must be green before any merge
```

Done when you can state the PR's **intent** in one sentence and list the paths it touches.

## 2. Classify

The first matching row wins.

| Class | Rule |
|---|---|
| **direction** | The PR settles a question nothing answered yet: a new gameplay rule, a contradiction of an ADR, or a workflow change Scott didn't ask for. A spec, ADR, issue, or Scott's request quoted in the PR body counts as an answer. |
| **significant** | It touches an **important system** (below), adds a dependency, or changes more than ~200 lines (lockfiles excluded). |
| **trivial** | Everything else: docs (not ADRs), comments, formatting, tests-only additions, small changes away from important systems, upstream skill refreshes (`npx skills update`). |

**Important systems** (as of 2026-11-13; extend this list when new ones appear):
- Agent environment: `.claude/`, owned skills under `.agents/skills/` (those absent from `skills-lock.json`), `AGENTS.md`, `CLAUDE.md`
- Build and checks: `.github/`, `package.json` dependencies, TypeScript/ESLint/Prettier/Vitest/dependency-cruiser config, git hooks
- Decisions: `docs/adr/`, `GLOSSARY.md`
- Game core: the rules engine and the client↔server protocol, wherever the workspace puts them

## 3. Act on the class

**trivial**: merge (step 4), then add the `merged-unreviewed` label so the audit sees it.

**significant**: run the `cross-review` skill. In each brief, state the intent and the **threat model**: what counts as high severity for this change, and what is out of scope. Then loop:
1. Fix every accepted finding on the PR branch, each with a regression test or check wherever one can exist. Small fixes yourself; larger ones go to the `delegate` skill's implement tier on the same branch.
2. Run a **re-check**: a fresh reviewer from the other family, briefed with the previous findings and the fix commits.
3. Merge when a re-check passes. **After two failed re-checks**, merge anyway only if every finding was fixed and pinned by a test, and none is design-level; otherwise escalate. Record that judgement in the PR comment.

**direction**: escalate (step 5). Merging is off the table until Scott answers.

## 4. Merge

```sh
gh api -X PUT repos/Scott-Poole/card-game/pulls/<n>/merge -f merge_method=merge
git switch main && git pull --ff-only && git branch -d <head-branch>
```

(`gh pr merge` can hit the Projects-classic GraphQL bug noted in `AGENTS.md`; REST avoids it.) Done when `main` contains the merge commit and the local branch is gone.

## 5. Escalate

Add the `ready-for-human` label and post one comment framed as a **decision**: the question, the options with their consequences, and your recommendation. Then stop; the PR waits for Scott.

## Every outcome

Post the verdict and the class on the PR (`gh pr comment <n> --body-file <file>`), and log each reviewer run per the `delegate` skill.

## Merge audit

For PRs labelled `merged-unreviewed`: review each merged diff (`gh pr diff <n>`) with the cross-review Skeptic lens. A real problem becomes a GitHub issue that links the PR. Then remove the label. Done when no merged PR carries the label.
