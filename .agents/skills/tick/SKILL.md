---
name: tick
description: >-
  One pass of the ticket queue: claim every ready ticket the usage caps allow and launch a
  work-ticket thread for each, then a planner if the queue runs dry. Use when the scheduled tick
  fires, or when asked to run the tick or dispatch the next ticket.
---

# Tick

Owned by this repo. The scheduled dispatcher: each run **drains the queue up to the caps**, claiming ready tickets one after another and starting one thread per ticket to take it from claim to merge (the `work-ticket` skill). When no ticket is ready, including after the run has claimed the last one, it starts a **planner** (the `plan` skill), so an empty queue refills itself while the implementers work. [`queue.sh`](queue.sh) does every query and label write, so a run is a few commands; spend nothing beyond them.

The queue is label-driven, and the tick is the only writer of claims:

```text
ready-for-agent ──claim──▶ in-progress ──PR merged──▶ closed
      ▲                        ├── escalated by its thread ──▶ ready-for-human (`## Needs you` comment)
      │                        └── no sign of life ──▶ CHECK: thread alive → heartbeat; dead → released
      └── Scott answers, swaps ready-for-human ◀─────────────────────────────────┘ for ready-for-agent
```

Each label answers "whose turn is it": `ready-for-agent` an agent's, `in-progress` an agent is working, `ready-for-human` Scott's (always with a `## Needs you` comment). Only `queue.sh escalate` sets `ready-for-human` on a claimed ticket, so `maxEscalated` counts real handoffs. A stale claim is not one: the tick asks T3 whether the thread lives (**Check**) instead of timing the claim.

Planners run beside implementers: one at a time, tracked by an open `planning` issue, rotating through `planning.categories` least recently run first. They skip the WIP and daily-claim caps (they only file tickets) but stop with everything else when tickets waiting on Scott hit `maxEscalated`.

Caps live in [`config.json`](config.json) and are read from `origin/main`: tickets in progress (every claim holds a slot while it lives), claims per UTC day, tickets automation has handed to Scott (`escalate`d ones only), hours without a sign of life before a claim is checked. The `planning` block holds the planner's own: on/off, runs per UTC day, tickets per run, and the category rotation. `implement.claudeShare` (0 to 1) is the fraction of tickets Claude implements; the rest go to Codex, and the cross-family review lands on the other subscription. No API reports usage, so Scott sets it by hand from the weekly meters at the start of each week: raise it when Codex is burning faster than Claude, lower it when the reverse. Tune them there (through a PR); `"enabled": false` stops dispatch and planning, and pausing the T3 schedule stops the runs themselves. Changing `queue.sh` means running [`test/test-queue.sh`](test/test-queue.sh).

Steps 1–4 are a loop: after recording a launch, or resolving a **Check**, go back to step 1. Keep the list of tickets this run has claimed (`<claimed>` below, space-separated, empty at first) and pass it to every `next` and `plan-open`: GitHub's listings can lag a label write by more than the seconds between calls, so `queue.sh` counts those claims against the caps itself and never offers them again. The caps end the loop: every claim uses an in-progress slot and a daily claim, and once a planner is open, `next` returns `NOOP`. After the loop, go to **Audit**. Your reply covers the whole run: every ticket launched, the planner if one started, and the `NOOP` line that ended it.

Completed parent specs stay open for Scott: `queue.sh parent-done <child>` swaps `ready-for-agent` for `ready-for-human` and comments once after all children close. Nothing waits on the spec. These unclaimed specs do not count toward `maxEscalated`, which counts claim history.

## 1. Ask the queue

Run the landed copy of the script, so a checkout on any branch obeys `main`:

```sh
git fetch -q origin main && git show origin/main:.agents/skills/tick/queue.sh | bash -s -- next <claimed>
```

It prints one line. A non-zero exit means a GitHub call failed partway: record its stderr and go to **Audit**, retrying nothing. `NOOP <reason>` → the run is over: go to **Audit**. `CHECK <n> <nudges> <title>` → go to **Check** below, then back to this step. `PLAN <category>` → go to **Plan** below. `LAUNCH <n> <title>` → continue.

## Check

`CHECK <n> <nudges> <title>` is a claim with no sign of life for `staleHours`: neither the claim label nor a heartbeat is that recent. The queue script cannot see T3, so you read the thread:

```sh
git show origin/main:.agents/skills/tick/queue.sh | bash -s -- resume-info <n>   # THREAD <link|none> CLAIMS <k>
```

`t3_thread_read` that thread (small `limit`; only its status matters), then:

- **Active** (`running`, `queued`, `starting`, `preparing`, `waiting`): `... -- alive <n>`. The thread is working, so the claim stays and its clock restarts.
- **Idle or ended** (`completed`, `idle`, `failed`, `interrupted`, `cancelled`) and `<nudges>` is under 3: wake it with `t3_thread_send`, "Resume: you still hold #<n>. Read the issue and its PR, finish the ticket per `work-ticket`, and merge or escalate.", then `... -- alive <n> nudged`. Threads that hit a usage limit or ended a turn waiting for a reply resume this way, keeping their branch, worktree and PR.
- **No link recorded** (`THREAD none`: the note after launch may have failed): look for the thread before giving up: `t3_thread_list` with `titleContains` `#<n> ` (the launch title) and the branch `ticket/<n>-*`; if found, treat it as the link above and `note <n> "work-ticket thread: <link>"` to repair the record.
- **Missing** (no thread exists by link or by title, it is gone, or the send fails): `... -- release <n> "thread gone"`. The ticket returns to `ready-for-agent` and a later launch resumes it (step 3).
- **Woken three times already** and still idle: escalate for real, `... -- escalate <n> "<## Needs you comment>"`, saying the thread keeps stopping without finishing, with the last status and any PR link.

If the read itself errors, stop the run: claim nothing more, mention the error in the reply, and go to **Audit**. (`next` would offer the same ticket again, so retrying here never ends.) `alive` and `release` change what `next` offers, so every other outcome terminates. `release` refuses a ticket whose thread escalated in the meantime; leave that one for Scott (a later `next` finishes an escalation whose claim removal failed, and drops the dead claim if Scott already handed the ticket back, so neither recurs as a CHECK). `<nudges>` counts only wakes since the current claim began, so a hand-back starts a fresh budget. `alive` also clears a `ready-for-human` the retired stale sweep left on a claimed ticket, recognised by that sweep's own comment (`the claim keeps its slot until you remove`); a `ready-for-human` without it belongs to an escalation, so `alive` leaves it and `release` refuses.

## 2. Claim

Read the ticket's history first, because claiming adds to it: `git show origin/main:.agents/skills/tick/queue.sh | bash -s -- resume-info <n>` prints `THREAD <link|none> CLAIMS <k>`. Keep that line for step 3. Then claim:

```sh
git show origin/main:.agents/skills/tick/queue.sh | bash -s -- claim <n>
```

A refusal means someone else holds the ticket: record the refusal and go to **Audit**. Another tick is running, so leave the rest of the queue to it. On success, add `<n>` to `<claimed>`.

## 3. Launch

If step 2's `resume-info` printed `CLAIMS` above 0, the ticket has claim history and this is a **resume**, typically Scott handing it back. When `THREAD` names a thread that still exists, `t3_thread_send` it "Scott handed #<n> back: read the issue comments after the last `## Needs you` and continue per `work-ticket`" instead of launching, record it with `note <n> "resumed work-ticket thread: <link>"`, and loop. Otherwise launch fresh as below with branch `ticket/<n>-<slug>-r<CLAIMS>` and, if `origin/ticket/<n>-*` exists, that remote branch as `baseRef`; `work-ticket` continues from the existing work.

Pick the model from the `delegate` skill's **implement** tier and copy its ids from `orchestrator_capabilities` (once per run; reuse them for later launches). The tier is split across two subscriptions so neither runs dry early: read `claudeShare` (`git show origin/main:.agents/skills/tick/config.json | jq .implement.claudeShare`), and launch Claude Sonnet 5.5 (effort `high`) when `<n> % 10 < claudeShare * 10`, otherwise Codex `gpt-6.1-sol` (effort `medium`). The ticket number decides, so the split needs no state and a re-run picks the same model. Scott retunes the share from the weekly usage meters (below). Then `t3_thread_launch`:

- `title`: `#<n> <title>`
- `workspaceStrategy`: `{type: "worktree", baseRef: "origin/main", startFromOrigin: true, branch: "ticket/<n>-<slug>"}`, slug = 3–5 kebab-case words from the title
- `modelSelection`: the implement-tier model and its options
- `message`:

  > Work GitHub issue #&lt;n&gt; on `Scott-Poole/card-game`, from claim to merge. Read `.agents/skills/work-ticket/SKILL.md` in this checkout and follow it exactly; the tick has already claimed the issue.

A top-level thread, never a `delegate_task` child: children can't watch a PR, and work-ticket may need to wait on CI.

If the launch fails, release the claim (`... | bash -s -- release <n> "<error>"`) and go to **Audit**.

## 4. Record

```sh
git show origin/main:.agents/skills/tick/queue.sh | bash -s -- note <n> "work-ticket thread: <link>"
```

Retry a failed `note` once; if it still fails, say so in the reply (**Check** recovers the thread by its title later). This ticket is done when it carries `in-progress`, a claim comment, and the thread link. Read the launched thread once with `t3_thread_read`: if it does not exist, release the claim (`... -- release <n> "launch failed"`); a thread whose first run failed on a usage limit resumes itself, so keep that claim and let **Check** nudge it later. Go back to step 1.

## Plan

When step 1 printed `PLAN <category>`:

1. Open the planning issue. It prints the issue number; a refusal means another planner is open, so reply with it and go to **Audit**.

   ```sh
   git show origin/main:.agents/skills/tick/queue.sh | bash -s -- plan-open <category> <claimed>
   ```

2. Pick the model from the `delegate` skill's **plan** tier, primary column, and `t3_thread_launch` it:

   - `title`: `Plan: <category> (#<n>)`
   - `workspaceStrategy`: `{type: "worktree", baseRef: "origin/main", startFromOrigin: true, branch: "plan/<n>-<category>"}`
   - `modelSelection`: the plan-tier model and its options
   - `message`:

     > Run a `<category>` planner for planning issue #&lt;n&gt; on `Scott-Poole/card-game`. Read `.agents/skills/plan/SKILL.md` in this checkout and follow it exactly; the tick has already opened the planning issue.

   If the launch fails, `... | bash -s -- plan-abort <n> "<error>"` and go to **Audit**.

3. Record the thread: `... | bash -s -- note <n> "planner thread: <link>"`.

Done when the planning issue is open with the thread link. Then go to **Audit** (only one planner runs at a time).

## Audit

After the claim loop ends for any reason (including NOOP, query or launch failure, refusal, or a planner launch), dispatch at most **one audit per tick run**. This is independent of the ticket and planner caps; the existing global off switch still applies.

1. Refresh the landed script and config: `git fetch -q origin main`. If the fetch fails, end audit dispatch and report the error. Then run `git show origin/main:.agents/skills/tick/queue.sh | bash -s -- audit-next`. `NONE` ends audit dispatch; a non-zero exit ends it with the error reported. On `AUDIT <pr>`, run `audit-claim <pr>`; a refusal or failure ends audit dispatch.
2. Read the PR title and determine the family that authored its changes from its implement row in `docs/agents/delegation-log.md`, the PR body, or the linked work-ticket thread (the shared GitHub login alone does not identify the model). If it cannot be established, record `author family unknown` and use the review tier’s third-family fallback, DeepSeek Flash, for this historical backlog. An unknown family alone never releases the claim or blocks dispatch. Include the uncertainty in the launch message so the auditor records it in the result.
3. Load `delegate` and use the **review** tier primary for a known author family: Codex-authored → Claude Sonnet 5.5; Claude-authored → Codex `gpt-6.1-sol`, effort `medium`. Copy current ids from `orchestrator_capabilities`; `delegate` is authoritative if its routing table changes. If the primary is unavailable, try its review fallback before releasing; never use the author’s family. Launch one top-level `t3_thread_launch`:
   - `title`: `Audit: #<pr> <title>`
   - `workspaceStrategy`: `{type: "worktree", baseRef: "origin/main", startFromOrigin: true}`
   - `modelSelection`: the chosen review model and options
   - `message`: "Run the merge audit from `.agents/skills/land/SKILL.md` for PR #<pr>."
4. On launch failure, run `audit-release <pr> "<error>"`. On success, comment the thread link on the PR using `note <pr> "audit thread: <link>"`.

Reply with every ticket and planner launched, the loop's ending reason or error, and the audit PR and thread link if launched. Done when audit dispatch has either launched one thread or reported NONE, a refusal, or an error.
