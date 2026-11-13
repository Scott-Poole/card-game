---
name: tick
description: >-
  One pass of the ticket queue: claim the next ready ticket and launch a work-ticket thread for
  it, within the usage caps. Use when the scheduled tick fires, or when asked to run the tick or
  dispatch the next ticket.
---

# Tick

Owned by this repo. The scheduled dispatcher: each run claims **at most one** ticket and starts one thread to take it from claim to merge (the `work-ticket` skill). [`queue.sh`](queue.sh) does every query and label write, so a run is a few commands; spend nothing beyond them.

The queue is label-driven, and the tick is the only writer of claims:

```text
ready-for-agent ──claim──▶ in-progress ──PR merged──▶ closed
                               ├── escalated by its thread ──▶ ready-for-human
                               └── stale ──▶ in-progress + ready-for-human (slot held until Scott clears it)
```

Caps live in [`config.json`](config.json) and are read from `origin/main`: tickets in progress (stale ones included), claims per UTC day, tickets automation has handed to Scott, hours before a claim counts as stale. Tune them there (through a PR); `"enabled": false` stops dispatch, and pausing the T3 schedule stops the runs themselves. Changing `queue.sh` means running [`test/test-queue.sh`](test/test-queue.sh).

## 1. Ask the queue

Run the landed copy of the script, so a checkout on any branch obeys `main`:

```sh
git fetch -q origin main && git show origin/main:.agents/skills/tick/queue.sh | bash -s -- next
```

It prints one line. A non-zero exit means a GitHub call failed partway: reply with its stderr and stop, retrying nothing. `NOOP <reason>` → reply with that line and stop. `LAUNCH <n> <title>` → continue. Stale claims it swept are on stderr; mention them in the reply.

## 2. Claim

```sh
git show origin/main:.agents/skills/tick/queue.sh | bash -s -- claim <n>
```

A refusal means someone else holds the ticket: reply with the refusal and stop.

## 3. Launch

Pick the model from the `delegate` skill's **implement** tier, primary column, and copy its ids from `orchestrator_capabilities`. Then `t3_thread_launch`:

- `title`: `#<n> <title>`
- `workspaceStrategy`: `{type: "worktree", baseRef: "origin/main", startFromOrigin: true, branch: "ticket/<n>-<slug>"}`, slug = 3–5 kebab-case words from the title
- `modelSelection`: the implement-tier model and its options
- `message`:

  > Work GitHub issue #&lt;n&gt; on `Scott-Poole/card-game`, from claim to merge. Read `.agents/skills/work-ticket/SKILL.md` in this checkout and follow it exactly; the tick has already claimed the issue.

A top-level thread, never a `delegate_task` child: children can't watch a PR, and work-ticket may need to wait on CI.

If the launch fails, release the claim (`... | bash -s -- release <n> "<error>"`) and stop.

## 4. Record

```sh
git show origin/main:.agents/skills/tick/queue.sh | bash -s -- note <n> "work-ticket thread: <link>"
```

Done when the issue carries `in-progress`, a claim comment, and the thread link, and your reply names the ticket and links the thread.
