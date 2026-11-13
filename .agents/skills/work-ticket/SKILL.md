---
name: work-ticket
description: >-
  Take one claimed GitHub ticket from claim to merge, unattended: implement it test-first, open
  the PR, land it through review, and merge. Use when a tick-launched thread starts, or when asked
  to work a ticket end to end.
---

# Work ticket

Owned by this repo. You are one thread, launched by the `tick` skill, in a fresh worktree from `origin/main` on branch `ticket/<n>-<slug>`. The issue already carries `in-progress`; the claim is yours. You own the ticket **from claim to merge**: you write the code, run the review, act on the findings with your full context, and merge. You get **one attempt**: when you're stuck, hand the ticket to Scott rather than looping.

Scott decides direction; you decide everything reversible. An ambiguous criterion with a sensible reading gets that reading, noted in the PR body, not an escalation.

## 1. Orient

```sh
gh issue view <n> --json number,title,body,labels,comments
```

Read the parent spec named under **Parent**, `AGENTS.md`, and the domain docs per `docs/agents/domain.md`. Confirm the issue carries `in-progress` and your branch is based on `origin/main`; otherwise stop and say why.

Done when you can list every acceptance criterion and the seam each one is proved at.

## 2. Build

Work test-first at the seams the spec names ([`tdd`](../tdd/SKILL.md)). Commit each logical change per [`commit`](../commit/SKILL.md), with `Refs: #<n>`.

Done when **every** acceptance criterion has evidence (command output, a test, a diff), and the repo's full check passes: `pnpm check` once it exists, before that the commands the ticket names.

## 3. Open the PR

Push the branch, then open a ready (non-draft) PR against `main`, body per [`pr`](../pr/SKILL.md), including `Closes #<n>` so the merge closes the ticket:

```sh
gh pr create --base main --head <branch> --title "<conventional title>" --body-file <file>
```

## 4. Land it

Run [`land`](../land/SKILL.md) on your own PR. You are the **author**, which changes three things, all stated in land:

- reviewers come from the family that is not yours;
- you fix accepted findings yourself, in this checkout;
- every finding you reject is argued and goes to the re-checker.

CI may still be running when review ends: land step 4.2 says how to wait for it.

## 5. Finish

Use the landed queue script for every label change:

```sh
Q() { git show origin/main:.agents/skills/tick/queue.sh | bash -s -- "$@"; }
```

- **Merged**: the ticket closes itself. Done.
- **Escalated** by land (`ready-for-human` or `review-blocked` on the PR): `Q escalate <n> "<PR link>: <one-line why>"`.
- **Stuck** (a criterion you can't meet, a ticket that contradicts the spec, a check you can't make pass): push what you have as a draft PR if you committed anything, then `Q escalate <n> "<what blocks it, what you tried, the draft PR>"`.

Done when the ticket is closed by your merge, or carries `ready-for-human` with a comment Scott can act on cold.
