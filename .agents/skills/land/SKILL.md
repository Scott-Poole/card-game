---
name: land
description: >-
  Take an open PR to merged, or to Scott: classify its risk, review as the class demands, then
  merge or escalate. Use when a PR is ready, when asked to land, merge, or ship a PR, for the
  PR-review automation, or for a merge audit.
---

# Land

Owned by this repo. Scott's policy: **trivial** PRs merge without review and get audited later; **significant** PRs merge on agent consensus after a cross-family review; Scott hears only about **direction** decisions nobody can settle logically. Agents decide every merge that fits the policy without asking.

`main` is protected on GitHub: PR required, no force push or deletion, merge commits only. The run may be unattended, so every step works from an explicit **pin**: the PR's head SHA you evaluated. Anything learned about one SHA says nothing about another.

**Author-run**: the PR's author may land its own PR (the `work-ticket` flow does), so the agent with the full context fixes the findings. Reviewers then come from the family that isn't the author's, and the author-run rules in steps 3 and 4 apply.

## 1. Read and pin

```sh
gh pr view <n> --json number,state,isDraft,isCrossRepository,author,title,body,headRefName,headRefOid,baseRefName,files,additions,deletions
```

Stop if it's closed or a draft. **Land handles only PRs whose branch lives in this repo** (`isCrossRepository` false). A fork PR comes from outside: add `needs-triage`, comment that it goes through `/triage`, and stop. Agents never merge outside code on their own consensus.

Record `PIN=<headRefOid>` and `BASE=origin/<baseRefName>`, then `git fetch origin <baseRefName> <headRefName>`. Find the **PR checkout** (call its path `WT`):

- `git worktree list` shows a worktree on `<headRefName>` → use it.
- Else, the local branch exists → `git worktree add .worktrees/pr-<n> <headRefName>`.
- Else → `git worktree add --track -b <headRefName> .worktrees/pr-<n> origin/<headRefName>`.

Then require `git -C $WT status --porcelain` to be empty, run `git -C $WT merge --ff-only origin/<headRefName>`, and confirm `git -C $WT rev-parse HEAD` equals `PIN`. If the checkout is dirty, can't fast-forward, or is ahead of `PIN` (unpushed local commits), stop and comment why: someone else is mid-change.

Every later command (reviews, fixes, pushes) runs in `WT`. Done when you can state the PR's **intent** in one sentence, and `WT`'s `HEAD` equals `PIN`.

## 2. Classify

Classify the diff `BASE...PIN`. The first matching row wins.

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

**trivial**: go to step 4 with `PIN` unchanged.

**significant**: run the `cross-review` skill over `BASE...PIN` in `WT`, passing the SHAs explicitly. Each brief states the intent and the **threat model** (what counts as high severity for this change; what is out of scope). Then loop:
1. Fix every accepted finding in `WT`, each pinned by a regression test or check wherever one can exist (small fixes yourself; larger ones via the `delegate` skill's implement tier, in `WT`). Commit, `git push`, and set `PIN` to the new head.
2. **Re-check**: a fresh other-family reviewer, briefed with the previous findings and the fix range `<old PIN>..<PIN>`.
3. Go to step 4 when a re-check passes. **After two failed re-checks**, proceed only if every finding was fixed and pinned by a test and none is design-level; otherwise escalate (step 5). Record that judgement in the PR comment.

**Author-run**: cross-review's lead judgment is yours, so rejections get checked. Each rejected finding gets a one-line reason in the verdict comment and goes, with that reason, into the next re-check brief. A rejected **high** finding always triggers a re-check, even when no fix was made. If the re-checker upholds it, escalate (step 5).

A review **counts** only if **every** reviewer it called for (each lens, or the re-checker) is from the other family, finished, and returned its findings list. For each one that fails to launch or return: relaunch once, then try the `delegate` skill's review fallback. If any required reviewer still hasn't completed, add the `review-blocked` label, comment why, and stop: a significant PR never merges under-reviewed.

**direction**: escalate (step 5). Merging is off the table until Scott answers.

## 4. Record, verify, merge

1. **Record** (significant, or any author-run): append each reviewer run to `docs/agents/delegation-log.md` in `WT`; an author-run land also appends the author's own **implement** row, its outcome set by the review (`pass`: no accepted findings; `fixed`: you fixed some). Commit (`docs(agents): log review of #<n>`), push. That record commit is the one change allowed after review: confirm `git diff --name-only <PIN> HEAD` lists only that file, then set `PIN` to the new head.
2. **Verify**: `gh pr view <n> --json headRefOid` equals `PIN`. If not, someone pushed: restart at step 1, which re-pins and re-syncs `WT`; classify and review the whole PR again. Then `gh pr checks <n>` for that head (no checks configured → skip):
   - **green** → merge.
   - **pending** → T3 `watch_pull_request` on the PR, end your turn, and resume here when it wakes you.
   - **failed** → author-run, first failure: fix in `WT`, push, and run it as a step-3 fix round (set `PIN`, re-check the fix range if the class is significant). A second CI failure, or any failure on a run you didn't author: comment it and escalate (step 5).
3. **Merge**, pinned. GitHub refuses if the head moved:
   ```sh
   gh api -X PUT repos/Scott-Poole/card-game/pulls/<n>/merge -f merge_method=merge -f sha=$PIN
   ```
   (`gh pr merge` can hit the Projects-classic GraphQL bug noted in `AGENTS.md`; REST avoids it.)
4. **Clean up**: if you created `.worktrees/pr-<n>`, `git worktree remove` it; if `WT` is another session's worktree, leave it. Then `git pull --ff-only` on the checkout that holds `main`, and `git branch -d <headRefName>` if no worktree still uses it. Trivial merges also get the `merged-unreviewed` label, except **record-only** PRs (every changed path is `docs/agents/delegation-log.md`), which need no audit.

Done when `main` contains the merge commit and step 4.4 is done.

## 5. Escalate

Add the `ready-for-human` label and post one comment framed as a **decision**: the question, the options with their consequences, and your recommendation. Then stop; the PR waits for Scott. Remove `.worktrees/pr-<n>` if you created it.

## Every outcome

Post the class and verdict on the PR (`gh pr comment <n> --body-file <file>`). Review records reach `main` only through the PR (step 4.1), never as a commit on `main`.

## Merge audit

For PRs labelled `merged-unreviewed`: review each merged diff (`gh pr diff <n>`) with the cross-review Skeptic lens. A real problem becomes a GitHub issue that links the PR. Remove the label. Log the audit's reviewer runs on a `chore/audit-<date>` branch and land that PR with this skill: it's trivial and record-only, so it creates no new audit work. Done when no merged PR carries the label.
