---
name: read-main
description: >-
  Fresh read-only view of origin/main. Use when what you need is the current state of main itself,
  and when handing a read-only child a checkout path.
---

# Read main

Owned by this repo. Scott's primary checkout and any older worktree can sit many commits behind `origin/main`; conclusions drawn from them are wrong about the project's current state. [`read-main.sh`](read-main.sh) fetches `origin/main` and moves one shared, detached worktree onto its tip.

```sh
.agents/skills/read-main/read-main.sh   # from any checkout of this repo
```

It prints the view's path, the tip's full SHA, subject and date, and a `behind` line for each checkout (yours, Scott's primary) that lacks commits. Read files under the printed `main-view` path with your normal tools. Done when you have read the code there and not in your own checkout.

- **The view is read-only and moves.** Every run by any agent resets it, discarding what was left in it and moving it to the newest tip. Write only in your own worktree or an OS-temp directory. Before concluding that something is missing from `main`, check that `git -C <view> rev-parse HEAD` still equals the SHA you were given.
- **One lookup?** After the script's fetch (or your own `git fetch origin main`), `git show origin/main:<path>`, `git grep <pattern> origin/main` and `git ls-tree -r origin/main` read the tip with no worktree at all, and cannot move under you.
- **A failed fetch exits non-zero** and prints no view. Report that you could not read current `main`; do not fall back to a local checkout.
- **Handing off a read-only child**: pass it the printed path and SHA, and tell it the view is read-only and that its writes go elsewhere. Never hand it the primary checkout.
- **To change code**, get your own worktree per `AGENTS.md`; the view needs no `pnpm install`. The script refuses to reset a worktree that has a branch checked out.

Tests: `pnpm test:read-main`.
