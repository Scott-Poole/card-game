# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                                                                                                                 |
| -------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `needs-triage`             | `needs-triage`       | Nobody has classified this yet; never used for "needs a decision"                                                                       |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information                                                                                                |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent                                                                                                 |
| `ready-for-human`          | `ready-for-human`    | Scott’s turn: a decision or action, always with a `## Needs you` comment; on a parent spec: all children closed, awaiting Scott’s close |
| `wontfix`                  | `wontfix`            | Will not be actioned                                                                                                                    |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.

## Whose turn is it

Each label says who acts next, so the board reads without opening a ticket:

| Label             | Whose turn                | What happens next                                                            |
| ----------------- | ------------------------- | ---------------------------------------------------------------------------- |
| _(none)_          | Nobody has looked         | `/triage` classifies it                                                      |
| `needs-triage`    | Whoever runs triage       | Triage moves it to one of the labels below                                   |
| `ready-for-agent` | An agent                  | The tick claims it, or resumes it if it was handed back                      |
| `in-progress`     | An agent, already working | The thread merges it, escalates it, or the tick wakes or releases the thread |
| `ready-for-human` | Scott                     | Read the latest `## Needs you` comment, answer it, hand it back              |
| `needs-info`      | The reporter              | Back to `needs-triage` when they reply                                       |

Planners and agents file anything that needs a decision as `ready-for-human` with a `## Needs you` comment, not `needs-triage`.

### The `## Needs you` comment

Every time an agent or planner hands a ticket to Scott it posts one comment (a completed parent spec is the exception: `queue.sh parent-done` posts its own "close this spec" notice), headed exactly `## Needs you`, that stands alone on GitHub (no thread link needed):

```markdown
## Needs you

**Decision (or action):** the one thing Scott must settle or do.

| Option | Consequence |
| ------ | ----------- |
| A      | ...         |
| B      | ...         |

**Recommendation:** A, because ...

**To answer:** comment your choice, then remove `ready-for-human` and add `ready-for-agent`.
```

`queue.sh escalate` refuses a comment that does not start with `## Needs you`. Add the evidence (a draft PR, a failing check) under the recommendation when the stop was a blocker.

### Handing back

Scott comments the answer, then swaps `ready-for-human` for `ready-for-agent`. The next tick treats a ticket with claim history as a resume: it wakes the original thread when it still exists, otherwise launches a fresh one that continues from the ticket's branch or PR and reads the comments after the last `## Needs you` as the answer.

A stale claim (an `in-progress` ticket with no sign of life for `staleHours`) is not a handoff and never gets `ready-for-human`: the tick reads the thread, then records a heartbeat, wakes it, or releases the claim. Only real escalations count toward `maxEscalated`.

## Automation labels

Outside the triage roles, the `tick` and `plan` skills use `in-progress` (a claimed ticket), `planning` (a planner run's tracking issue, open while it runs), `review-blocked` and `merged-unreviewed` (set by `land`), and `audit-in-progress` (a merged PR claimed for audit).

Completed parent specs stay open: `queue.sh parent-done <child>` replaces `ready-for-agent` with `ready-for-human` and comments once. Scott closes the spec when the outcome matches; nothing waits on it.
