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

Fix the diff range: `git diff --stat <base>...HEAD`. Size picks the reviewers (lenses in [LENSES.md](LENSES.md)):

| Size | Reviewers |
|---|---|
| < 50 lines, 1–2 files | Skeptic |
| 50–200 lines, 3–5 files | Skeptic, Architect |
| 200+ lines or 5+ files | Skeptic, Architect, Minimalist |

## 2. Spawn reviewers

Use the `delegate` skill's **review** tier: the family that did *not* write the code. Launch all reviewers in parallel with `delegate_task`, `role: "review"`, `isolation: "shared"`.

Each brief contains: the intent, the base ref and the `git diff` command to run, the full text of its one lens from LENSES.md, and this instruction:

> You are an adversarial reviewer. Find real problems; do not validate the work. Read-only: change no files. Cite file:line and a concrete failure scenario for each finding. Rate each: **high** (blocks merge), **medium** (should fix), **low** (worth noting). Reply with a numbered markdown list as your final message.

Done when every reviewer has returned, or you've recorded that it failed. A missing reviewer goes in the verdict; never skip it silently.

## 3. Verdict

Deduplicate overlapping findings, then write:

```
## Intent
## Verdict: PASS | CONTESTED | REJECT — <one line>
## Findings          (high → low; each: severity, file:line, lens, recommendation)
## What went well    (1–3 items)
## Lead judgment     (each finding: accept / reject + one-line reason)
```

- **PASS**: no high-severity findings. **CONTESTED**: high findings that reviewers disagree on. **REJECT**: high findings with consensus.
- Lead judgment is yours (the judge tier): reviewers are adversarial by design, so call out false positives, overreach, and style mistaken for substance.

Log each reviewer run in `docs/agents/delegation-log.md` per the `delegate` skill.
