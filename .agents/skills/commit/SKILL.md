---
name: commit
description: >
  Create conventional commit messages. Use when the user says "commit this", "save changes",
  "git commit", asks to commit code, write a commit message, or format git history.
---

# Conventional Commits

Tailored from poteto/noodle; owned by this repo (not in `skills-lock.json`).

## Branching

Commit on a feature branch, and land it on `main` through a PR. If you're on `main`, branch first: `git switch -c <type>/<short-name>`. Inside a T3 worktree, commit in the worktree's own branch.

## Rules

- **One commit per logical change**: never combine unrelated fixes or features. Three independent changes = three commits.
- **Only commit files you changed**: stage paths explicitly; never pull in unrelated files from concurrent sessions.
- **Always include a body**: no title-only commits. Explain what and why.
- **Sequence commits** to maximise option value: foundational infrastructure first, then features that build on it.
- Format: `<type>(<scope>): <description>`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`. Add `Refs: #<issue>` when the work comes from an issue.

## Example

```
feat(engine): Resolve card reveals in priority order

The player winning the most locations reveals first; ties fall back
to a seeded coin flip so replays stay deterministic.

Refs: #12
```
