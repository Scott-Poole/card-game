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

Stop if it's a draft or closed unmerged. If `state` is `MERGED`, take [Resume after merge](#resume-after-merge) instead of continuing here: it files what is pending, or stops when nothing is. **Land handles only PRs whose branch lives in this repo** (`isCrossRepository` false). A fork PR comes from outside: add `needs-triage`, comment that it goes through `/triage`, and stop. Agents never merge outside code on their own consensus.

Record `PIN=<headRefOid>` and `BASE=origin/<baseRefName>`, then `git fetch origin <baseRefName> <headRefName>`. Find the **PR checkout** (call its path `WT`):

- `git worktree list` shows a worktree on `<headRefName>` → use it, unless it is the first entry (Scott's primary checkout, which agents never edit): then stop and comment that Scott has the branch checked out.
- Else, the local branch exists → `git worktree add "$HOME/.t3/worktrees/card-game/pr-<n>" <headRefName>`.
- Else → `git worktree add --track -b <headRefName> "$HOME/.t3/worktrees/card-game/pr-<n>" origin/<headRefName>`.

Then require `git -C $WT status --porcelain` to be empty, run `git -C $WT merge --ff-only origin/<headRefName>`, and confirm `git -C $WT rev-parse HEAD` equals `PIN`. If the checkout is dirty, can't fast-forward, or is ahead of `PIN` (unpushed local commits), stop and comment why: someone else is mid-change.

Every later command (reviews, fixes, pushes) runs in `WT`. Done when you can state the PR's **intent** in one sentence, and `WT`'s `HEAD` equals `PIN`.

## 2. Classify

Classify the diff `BASE...PIN`. The first matching row wins.

| Class           | Rule                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **direction**   | The PR requires an unanswered decision that qualifies under the decision rule. A spec, ADR, issue, or Scott's request quoted in the PR body counts as an answer.         |
| **significant** | It touches an **important system** (below), adds a dependency, or changes more than ~200 lines (lockfiles excluded).                                                     |
| **trivial**     | Everything else: docs (not ADRs), comments, formatting, tests-only additions, small changes away from important systems, upstream skill refreshes (`npx skills update`). |

**Important systems** (as of 2026-11-13; extend this list when new ones appear):

- Agent environment: `.claude/`, owned skills under `.agents/skills/` (those absent from `skills-lock.json`), `AGENTS.md`, `CLAUDE.md`
- Build and checks: `.github/`, `package.json` dependencies, TypeScript/ESLint/Prettier/Vitest/dependency-cruiser config, git hooks
- Decisions: `docs/adr/`, `GLOSSARY.md`
- Game core: the rules engine and the client↔server protocol, wherever the workspace puts them

## 3. Act on the class

**trivial**: go to step 4 with `PIN` unchanged.

**significant**: run the `cross-review` skill over `BASE...PIN` in `WT`, passing the SHAs explicitly. Each brief states the intent and the **threat model** (what counts as high severity for this change; what is out of scope). Before launching, compare `git diff --stat BASE...PIN` with the ticket's named files. Explain each extra file in the PR body or split it out. For process PRs, briefs must explicitly name the failure injections in scope and those excluded; re-checks retain this threat model. Read the cumulative verdict on resume: its PR totals row is authoritative for counters and existing follow-up links. Then loop:

1. Classify every finding using [cross-review's disposition rule](../cross-review/SKILL.md#disposition). Fix accepted **blocking** findings in `WT`, with a regression check wherever one can exist. Follow [validate](../validate/SKILL.md), commit, push, and set `PIN` to the new head. A fix round is one batch of fixes followed by a fresh re-check; the initial review is round 0.
2. **Re-check** with a fresh other-family reviewer. Build the brief per [delegate section 3](../delegate/SKILL.md#3-write-the-brief), so it carries the full disposition text, the acceptance criteria, and the current fix-round count, plus previous findings, rejected findings and reasons, the original threat model, and `<old PIN>..<PIN>`. Re-checks judge the fixes and regressions against that model. A no-fix dispute re-check has no fix range (`<old PIN>..<PIN>` is empty): the brief instead names the unchanged `PIN` and lists each disputed finding with the author's rejection reason. Accepted **follow-ups** go through cross-review's follow-up handling, never another fix round.
3. Go to step 4 when no blocking finding remains and required reviews are complete. Every PR has a maximum of **3 review-driven fix rounds**, cumulative across resumes and head changes. A fresh review after a head change is not a fix round. CI-only repairs do not consume this budget; diagnose and fix them under the decision rule, and re-check significant repairs. Trivial PRs have no review fix rounds unless reclassified significant. At round 3, merge only with green CI and no remaining blocker; otherwise escalate a **direction** question: “The scope keeps expanding: split the change, or accept the current threat model?” Include the remaining blockers and options. A recorded direction answer may authorize an explicit additional budget or split the PR; record the answer and new limit in the verdict before resuming. Present concrete options and consequences for the remaining blockers; accepting the existing threat model alone does not resolve an in-model defect. This scope decision is the ticket-authorized exception to progress-based iteration; never merge an unresolved blocker merely because the budget ran out. If the same blocker survives two materially different fixes, diagnose it before using the remaining budget.

**Author-run**: cross-review's lead judgment is yours. Each rejected finding gets a one-line reason in the verdict and goes into the next re-check brief. Reclassifying an out-of-model high as a follow-up is not rejection: record the reason and carry it to later briefs without launching a re-check for it. Rejection of an in-model **high** triggers one fresh re-check even with no fix; it does not consume a fix round. Allow at most one no-fix rejection re-check per PR; send all disputed findings together. If further in-model high disputes remain after that check, use the direction path with the concrete scope disagreement rather than launching another no-fix review. If upheld as a reproducible blocking defect, accept it and fix within the remaining budget; at the cap use the direction path above.

**Out providers.** Follow [delegate’s provider availability rule](../delegate/SKILL.md#provider-availability) before choosing a provider, including reviewers.

A review **counts** only if **every** reviewer it called for (each lens, or the re-checker) is from a family other than the author's (for work authored by Claude: Codex, or the Flash pair, free tier then paid per `delegate`, when Codex is out of usage), finished, and returned its findings list. For each one that fails to launch or return (a Flash reviewer follows `delegate`'s free-then-paid order instead of a plain relaunch): relaunch once, then try the `delegate` skill's review fallback. A Codex usage-limit failure skips the relaunch and goes straight to the Flash pair (free first, then paid; see `delegate`): quote the failing launch's error in the verdict, and keep that substitution for the PR's later re-checks. Do not wait for the reset; a Flash-written PR is never reviewed by Flash. If any required reviewer still hasn't completed, add the `review-blocked` label, comment why, and stop: a significant PR never merges under-reviewed.

**direction**: escalate (step 5). Merging is off the table until Scott answers.

## 4. Record, verify, merge

1. **Record** (significant, or any author-run): write each reviewer run into the `## Runs` table in the PR's verdict comment per `delegate`. An author-run land includes the author's own **implement** row, with outcome set by review (`pass`: no accepted findings; `fixed`: you fixed some). Identify the evaluated head SHA in the verdict. Update the single cumulative verdict comment per `delegate`.
2. **Verify locally and on GitHub**: run the repo's full local gate (`pnpm check` here, which sets CI mode) at the evaluated head before pushing. Local hooks are fast feedback, not a security boundary; keep GitHub's required check as independent verification. Then `gh pr view <n> --json headRefOid` equals `PIN`. If not, someone pushed: restart at step 1, which re-pins and re-syncs `WT`; classify and review the whole PR again. Then `gh pr checks <n>` for that head (skip only when the base branch has no required checks and the repository has no CI workflow; an absent required check is not a pass):
   - **green** → merge.
   - **absent or infrastructure-blocked** → inspect workflow runs and annotations. Diagnose runner availability and retry transient failures; use step 5 only when the decision rule requires Scott’s access or action, stating exactly what he must supply. If a required check has not started, diagnose its trigger; never treat its absence as success.
   - **pending** → first distinguish a running/queued job from one blocked by unavailable infrastructure. For a healthy run, T3 `watch_pull_request` on the PR, end your turn, and resume here when it wakes you.
   - **failed** → read the failing job log and annotations. For infrastructure failures, diagnose and retry; use step 5 only for a qualifying decision or action under the decision rule. For a code failure, reproduce locally with the pinned toolchain and CI environment, fix in `WT`, and run the full local gate before committing or pushing. Treat environment differences as bugs in local verification; update the gate so the failure is reproducible locally. Push and run it as a step-3 fix round (set `PIN`, re-check the fix range if significant). Apply step 3's distinction between CI-only repairs and review-driven fix rounds; a second CI failure alone is not a handoff.
3. **Merge**, pinned. First check the PR title is a conventional commit; if not, fix it through REST (`gh api -X PATCH repos/Scott-Poole/card-game/pulls/<n> -f title=...`), which doesn't move the head. GitHub refuses the merge if the head moved:
   ```sh
   gh api -X PUT repos/Scott-Poole/card-game/pulls/<n>/merge -f merge_method=squash -f sha=$PIN
   ```
   (`gh pr merge` can hit the Projects-classic GraphQL bug noted in `AGENTS.md`; REST avoids it.)
4. **Follow-ups**: land alone owns filing. After merge, reconcile accepted follow-ups using [cross-review's disposition rule](../cross-review/SKILL.md#disposition), against the merged code. File eligible tickets with the PR and squash commit links; retain notes for findings superseded by fixes, without full criteria, or beyond the cap. Update the cumulative verdict and PR totals, setting the totals `<state>` to `merged; filing complete` once every accepted follow-up is a ticket link or carries a permanent reason. Before merge, and on escalation or abandonment, retain notes only: they are not dispatchable tickets yet. Record each one in `## Follow-ups` as `pending: file after merge`, with the reviewer's acceptance criteria, `file:line` and scenario verbatim, so a resumed run can file it from the verdict alone.
5. **Clean up**: `git fetch origin main` (never pull in Scott's primary checkout; it is his to update). Run `bash .agents/skills/tick/worktrees.sh prune-branches` to delete local branches proven merged at their exact tip; checked-out branches are retained for a later sweep. It reports remote branches and leaves them intact. On a nonzero exit, record the partial failure and continue the remaining cleanup; failed proof never permits deletion. Last, if you created `$HOME/.t3/worktrees/card-game/pr-<n>`, `git worktree remove` it, since your shell may be standing in it; if `WT` is another session's worktree, leave it.

Done when `origin/main` contains the squash commit and step 4.5 is done.

## Resume after merge

A crash after the merge but before step 4.4 finishes leaves accepted follow-ups unfiled. Land resumes there, and only there: **filing and cleanup**. No tick wakes a merged PR whose ticket is closed, so a person reruns `land <n>` on it.

A follow-up in the cumulative verdict's `## Follow-ups` is **settled** when it has a ticket link or a permanent reason (superseded by a fix, no full criteria, beyond the cap, ticket creation failed), and **pending** otherwise, including `pending: file after merge`. Links live in `## Follow-ups`; the `PR totals` row (per `delegate`) holds counters and `<state>` only.

1. Read the verdict (`delegate`'s per-PR lookup). No verdict: stop, nothing to file. Take the squash commit from `gh pr view <n> --json mergeCommit`. If the totals `<state>` is `merged; filing complete` and no follow-up is pending, stop. A missing totals row does not stop recovery: judge by `## Follow-ups`.
2. Skip every settled follow-up. For each pending one, search open and closed issues (`gh issue list --state all --search <terms>`) for a ticket naming **that** follow-up's finding or `file:line`, per cross-review's disposition rule; link what you find instead of filing again. A ticket that merely references the PR or squash commit proves nothing about any other follow-up.
3. File each remaining pending follow-up that carries reviewer criteria as step 4.4 says (PR and squash commit links; the cumulative new-ticket cap). Without criteria, record it with a permanent reason. Update the verdict and `PR totals`, ending at `merged; filing complete`.
4. Clean up (step 4.5).

**Never push, review, or merge on this path.** It runs no `cross-review` and no fix rounds, and it creates no PR checkout or branch. The squash commit is the evidence; a defect found now is a new follow-up, not a fix to this PR.

Done when no follow-up is pending, the totals `<state>` is `merged; filing complete`, and step 4.5 is done.

## 5. Escalate

Add the `needs-triage` label and post one comment headed `## Needs you`, framed as a **decision**: the question, the options with their consequences, your recommendation, and how to hand back (triage resolves the question, folds the answer into the ticket, then swaps `needs-triage` for `ready-for-agent`). It must read on its own, without a thread link. When the PR closes a ticket, the ticket is where Scott answers and swaps labels: land mirrors this comment onto it with `Q escalate`, so name the ticket (`Closes #<n>`) in the PR comment. Define `Q() { git show origin/main:.agents/skills/tick/queue.sh | bash -s -- "$@"; }`. When this PR closes a ticket, define `Q() { git show origin/main:.agents/skills/tick/queue.sh | bash -s -- "$@"; }`, run `Q escalate <n> "<same handoff comment>"` using the landed queue helper, then immediately follow [triage’s launch flow](../triage/SKILL.md#launch-a-grilling-thread). The later work-ticket finish path must check for this existing handoff rather than duplicate it. For a standalone PR, leave the PR handoff for triage. Then stop work on this ticket; the PR waits for Scott. File work independent of the answer as its own ticket per [`to-tickets`](../to-tickets/SKILL.md). Remove `$HOME/.t3/worktrees/card-game/pr-<n>` if you created it.

## Every outcome

Create the class and verdict comment once, then PATCH that same comment on later outcomes or resume; use `delegate`'s per-PR lookup and create/update commands. Include the cumulative `## Runs` table (step 4.1) in that verdict comment, including on review-blocked, escalated, or abandoned exits. Record completed and failed runs even when merging is impossible.
