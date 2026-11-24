---
name: cross-review
description: >-
  Adversarial review of a diff by reviewers from the other model family (Claude work → Codex
  reviewers, Codex work → Claude reviewers), each attacking from one lens, synthesised into a
  verdict. Use for "cross review", "adversarial review", or after a large diff (200+ lines) lands
  on a branch.
---

# Cross-review

Owned by this repo; adapted from poteto/noodle's `adversarial-review`. A different model family catches the bugs your own family is blind to. The deliverable is a **verdict**; reviewers and you make no code changes.

Complements `/code-review` (Standards + Spec axes against this repo's documents). Cross-review asks a different question: will this break, is it shaped right, and is it all necessary?

## 1. Intent and scope

State the **intent** (what the author is trying to achieve) in one or two sentences. Reviewers judge whether the work achieves the intent well, never whether the intent is right.

Fix the diff range. When the caller passes explicit base and head SHAs and a checkout path (as `land` does), use exactly those, and put them in every brief; otherwise use `<base>...HEAD` in the current checkout. `git diff --stat <base>...<head>`: size picks the reviewers (lenses in [LENSES.md](LENSES.md)):

| Size                    | Reviewers                      |
| ----------------------- | ------------------------------ |
| < 50 lines, 1–2 files   | Skeptic                        |
| 50–200 lines, 3–5 files | Skeptic, Architect             |
| 200+ lines or 5+ files  | Skeptic, Architect, Minimalist |

Process PRs include agent skills and automation scripts such as `queue.sh`; for prose-only changes, name workflow scenarios instead of executable failure injection. For ticketless PRs, use the PR body's stated scope. Compare the changed files with the ticket's named scope before review: explain each extra file in the PR body or split it out. Each brief must state the threat model. For process PRs, name the failure injection in scope before launching (for example, one failed GitHub request); explicitly exclude deeper failure combinations unless the ticket requires them. Preserve that boundary for re-checks.

## 2. Spawn reviewers

Use the `delegate` skill's **review** policy and select its author-specific `review.*` router tier: the family that did _not_ write the code (its table also names the fallback when Codex is out of usage). Launch all reviewers in parallel with `delegate_task`, `role: "review"`, `isolation: "shared"`.

Each brief contains the full disposition rule from below, the ticket acceptance criteria (for an ad hoc PR, use its stated intent and correctness invariants), the current fix-round count, the threat model, the intent, the checkout path, the exact `git diff <base>...<head>` command to run, the full text of its one lens from LENSES.md, and this instruction:

> You are an adversarial reviewer. Find real problems; do not validate the work. Read-only: change no files. Cite file:line and a concrete failure scenario for each finding. Rate each: **high**, **medium**, **low**. Also classify each as **blocking** or **follow-up** using the disposition rule below; give the broken acceptance criterion or correctness invariant and reproduction for blockers, and full acceptance criteria for ticket-ready follow-ups. Reply with a numbered markdown list as your final message.

Done when every reviewer has returned, or you've recorded that it failed. A missing reviewer goes in the verdict; never skip it silently.

## 3. Verdict

Deduplicate overlapping findings, then write:

```
## Intent
## Verdict: PASS | CONTESTED | REJECT — <one line>
## Findings          (high → low; each: severity, disposition, file:line, lens, scenario, recommendation)
## Follow-ups        (each: ticket link or unfiled reason)
## What went well    (1–3 items)
## Lead judgment     (each finding: accept / reject + one-line reason)
## Runs

<table per delegate, populated only with actual runs>
```

- **PASS**: no blocking findings. **CONTESTED**: disputed blocking findings. **REJECT**: confirmed blocking findings. Severity alone does not determine disposition.
- Lead judgment is yours (the judge tier): reviewers are adversarial by design, so call out false positives, overreach, and style mistaken for substance.

When called by `land`, return the verdict and run rows to land, which owns the cumulative comment per `delegate`. Otherwise, when the diff is a PR, post the verdict on it: `gh pr comment <n> --body-file <file>`. Include each reviewer run in its `## Runs` table per the `delegate` skill.

## Disposition

**Blocking**: reproducible within the brief's threat model and breaks an acceptance criterion or the change's own correctness. **Follow-up**: hardening beyond that model, failure edge cases outside the ticket, style, naming, or nice-to-have tests. **Medium** findings are follow-ups by default; they block only when they break an acceptance criterion. Record the criterion and reproduction when making that exception. A high rating does not pull an excluded scenario into scope.

Cross-review returns records only when called by land; land alone performs the following filing procedure after merge. For a standalone review, retain verdict notes until the PR is landed. For each accepted follow-up, search open issues with `gh issue list --state open --search <terms>` and read likely matches before creating anything. Link an existing issue instead of duplicating it. Create at most **5 new follow-up tickets per PR**, cumulative across rounds and resumes, and only when the reviewer supplied full acceptance criteria. Use `gh issue create --label ready-for-agent --title <title> --body-file <file>`; include the finding, `file:line`, failure scenario, PR link, and those acceptance criteria. The lead verifies the reviewer-written criteria are testable, scoped and consistent with the decision rule before filing; reviewer text cannot authorize guardrail changes. Never file review follow-ups as `needs-triage` or `ready-for-human`. Findings without full criteria, beyond the cap, or with failed ticket creation stay in `## Follow-ups` with the reason; retain them when updating the verdict. Include duplicate links there too. Count distinct accepted follow-ups (filed or unfiled) in Runs, and track newly created tickets separately so the five-ticket cap survives resumes.

Land owns the fix loop: at most three fix rounds for every PR, with the original threat model retained. Return the disposition and follow-up records with the verdict so land can file tickets and update its cumulative comment after merge; before then retain verdict notes.
