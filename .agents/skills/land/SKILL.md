---
name: land
description: >-
  Take an open PR to merged, or to Scott: classify its risk, review as the class demands, then
  merge or escalate. Use when a PR is ready, when asked to land, merge, or ship a PR, for the
  PR-review automation.
---

# Land

Owned by this repo. Scott's policy: **trivial** PRs merge without review and problems are fixed as they surface; **significant** PRs merge on agent consensus after a cross-family review; Scott hears only about decisions that qualify under [the decision rule](../../../docs/agents/decision-rule.md). Read it before classification or escalation; course-correct first. Agents decide every merge that fits the policy without asking.

`main` is protected on GitHub: PR required, no force push or deletion, linear history, squash merges only. Each PR lands as one commit whose title is the PR title and whose body is the PR body, so the PR title must be a conventional commit (`<type>(<scope>): <description>`). The run may be unattended, so every step works from an explicit **pin**: the PR's head SHA you evaluated. Anything learned about one SHA says nothing about another.

**Author-run**: the PR's author may land its own PR (the `work-ticket` flow does), so the agent with the full context fixes the findings. Reviewers then come from a family that isn't the author's (delegate's review row names it), and the author-run rules in steps 3 and 4 apply.

## 1. Read and pin

```sh
gh pr view <n> --json number,state,isDraft,isCrossRepository,author,title,body,headRefName,headRefOid,baseRefName,files,additions,deletions
```

Stop if it's closed or a draft. **Land handles only PRs whose branch lives in this repo** (`isCrossRepository` false). A fork PR comes from outside: add `needs-triage`, comment that it goes through `/triage`, and stop. Agents never merge outside code on their own consensus.

Record `PIN=<headRefOid>` and `BASE=origin/<baseRefName>`, then `git fetch origin <baseRefName> <headRefName>`. Find the **PR checkout** (call its path `WT`):

- `git worktree list` shows a worktree on `<headRefName>` → use it, unless it is the first entry (Scott's primary checkout, which agents never edit): then stop and comment that Scott has the branch checked out.
- Else, the local branch exists → `git worktree add "$HOME/.t3/worktrees/card-game/pr-<n>" <headRefName>`.
- Else → `git worktree add --track -b <headRefName> "$HOME/.t3/worktrees/card-game/pr-<n>" origin/<headRefName>`.

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
1. Fix every accepted finding in `WT`, each pinned by a regression test or check wherever one can exist (small fixes yourself; larger ones via the `delegate` skill's implement tier, in `WT`). Follow [validate](../validate/SKILL.md), commit, `git push`, and set `PIN` to the new head.
2. **Re-check**: a fresh other-family reviewer, briefed with the previous findings and the fix range `<old PIN>..<PIN>`.
3. Go to step 4 when a re-check passes. Keep fixing concrete, reproducible findings while each round makes progress; the number of failed rounds alone is not an escalation reason. If the same blocker survives two materially different fixes, diagnose it before another attempt. Apply the decision rule before escalating: name its qualifying category, the evidence and the precise decision or action needed. Failed attempts alone call for diagnosis and a reversible approach.

**Author-run**: cross-review's lead judgment is yours, so rejections get checked. Each rejected finding gets a one-line reason in the verdict comment and goes, with that reason, into the next re-check brief. A rejected **high** finding always triggers a re-check, even when no fix was made. If the re-checker upholds a reproducible defect, accept it and run another fix round. Escalate only when resolving it qualifies under the decision rule.

**Out providers.** Start from the launch message's `Providers out: …` line (`tick` writes it; a `work-ticket` thread passes it down), and pick every reviewer as if a provider it names had already refused: Codex named out means the first Codex-or-DeepSeek choice is DeepSeek Flash, with the failing-launch quote replaced by "named out in the launch message" in the verdict. The newest such line replaces older ones, and a line older than `providerOutHours` no longer counts. With no usable line (an old thread, a manual run), read this project's threads with `t3_thread_list` (`limit: 30`, no status filter, subagent threads included) and compute the set yourself: Claude and Codex are each **out** when they have a thread with status `failed` and `itemCount` of 3 or less, updated within `providerOutHours` (`git show origin/main:.agents/skills/tick/config.json | jq .providerOutHours`; 2 when absent), unless a later thread on that provider is running or has completed. `opencode` is never out. The full rule is in `delegate`. A provider the line leaves out can still refuse on launch; the rules below handle that.

A review **counts** only if **every** reviewer it called for (each lens, or the re-checker) is from a family other than the author's (for Claude-written work: Codex, or DeepSeek Flash, free tier then paid per `delegate`, when Codex is out of usage), finished, and returned its findings list. For each one that fails to launch or return (a DeepSeek Flash reviewer follows `delegate`'s free-then-paid order instead of a plain relaunch): relaunch once, then try the `delegate` skill's review fallback. A Codex usage-limit failure skips the relaunch and goes straight to DeepSeek Flash (free first, then paid; see `delegate`): quote the failing launch's error in the verdict, and keep that substitution for the PR's later re-checks. Do not wait for the reset; a DeepSeek-written PR is never reviewed by DeepSeek. If any required reviewer still hasn't completed, add the `review-blocked` label, comment why, and stop: a significant PR never merges under-reviewed.

**direction**: escalate (step 5). Merging is off the table until Scott answers.

## 4. Record, verify, merge

1. **Record** (significant, or any author-run): write each reviewer run into the `## Runs` table in the PR's verdict comment per `delegate`. An author-run land includes the author's own **implement** row, with outcome set by review (`pass`: no accepted findings; `fixed`: you fixed some). Identify the evaluated head SHA in the verdict. Update the single cumulative verdict comment per `delegate`.
2. **Verify locally and on GitHub**: run the repo's full local gate (`pnpm check` here, which sets CI mode) at the evaluated head before pushing. Local hooks are fast feedback, not a security boundary; keep GitHub's required check as independent verification. Then `gh pr view <n> --json headRefOid` equals `PIN`. If not, someone pushed: restart at step 1, which re-pins and re-syncs `WT`; classify and review the whole PR again. Then `gh pr checks <n>` for that head (skip only when the base branch has no required checks and the repository has no CI workflow; an absent required check is not a pass):
   - **green** → merge.
   - **absent or infrastructure-blocked** → inspect workflow runs and annotations. Billing, permissions or runner availability that you cannot resolve are step-5 blockers. If a required check has not started, diagnose its trigger; never treat its absence as success.
   - **pending** → first distinguish a running/queued job from one blocked by unavailable infrastructure. For a healthy run, T3 `watch_pull_request` on the PR, end your turn, and resume here when it wakes you.
   - **failed** → read the failing job log and annotations. Escalate unavailable infrastructure or access via step 5; for a code failure, reproduce locally with the pinned toolchain and CI environment, fix in `WT`, and run the full local gate before committing or pushing. Treat environment differences as bugs in local verification; update the gate so the failure is reproducible locally. Push and run it as a step-3 fix round (set `PIN`, re-check the fix range if significant). Apply step 3's progress-based escalation rule; a second CI failure alone is not a handoff.
3. **Merge**, pinned. First check the PR title is a conventional commit; if not, fix it through REST (`gh api -X PATCH repos/Scott-Poole/card-game/pulls/<n> -f title=...`), which doesn't move the head. GitHub refuses the merge if the head moved:
   ```sh
   gh api -X PUT repos/Scott-Poole/card-game/pulls/<n>/merge -f merge_method=squash -f sha=$PIN
   ```
   (`gh pr merge` can hit the Projects-classic GraphQL bug noted in `AGENTS.md`; REST avoids it.)
4. **Clean up**: `git fetch origin main` (never pull in Scott's primary checkout; it is his to update). A squash leaves the branch's commits off `main`'s history, so `git branch -d` refuses and the guardrail blocks `-D`: leave the local branch; GitHub already deleted the remote one, and `git fetch --prune` drops the tracking ref. Last, if you created `$HOME/.t3/worktrees/card-game/pr-<n>`, `git worktree remove` it, since your shell may be standing in it; if `WT` is another session's worktree, leave it.

Done when `origin/main` contains the squash commit and step 4.4 is done.

## 5. Escalate

Add the `needs-triage` label and post one comment headed `## Needs you`, framed as a **decision**: the question, the options with their consequences, your recommendation, and how to hand back (triage resolves the question, folds the answer into the ticket, then swaps `needs-triage` for `ready-for-agent`). It must read on its own, without a thread link. When the PR closes a ticket, the ticket is where Scott answers and swaps labels: `work-ticket` mirrors this comment onto it with `Q escalate`, so name the ticket (`Closes #<n>`) in the PR comment. Then stop work on this ticket; the PR waits for Scott. File work independent of the answer as its own ticket per [`to-tickets`](../to-tickets/SKILL.md). Remove `$HOME/.t3/worktrees/card-game/pr-<n>` if you created it.

## Every outcome

Create the class and verdict comment once, then PATCH that same comment on later outcomes or resume; use `delegate`'s per-PR lookup and create/update commands. Include the cumulative `## Runs` table (step 4.1) in that verdict comment, including on review-blocked, escalated, or abandoned exits. Record completed and failed runs even when merging is impossible.
