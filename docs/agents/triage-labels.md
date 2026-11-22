# Triage labels

Tickets have two readiness buckets: `ready-for-agent` means every question is resolved and the ticket is implementable; `needs-triage` means it is not yet ready and the nightly task settles it. Blocking dependencies are separate from readiness. `wontfix` records a rejected request on a closed issue.

## Whose turn is it

| Label                      | Whose turn              | Next action                                                                                               |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| _(none)_ or `needs-triage` | Triage                  | Resolve questions, then mark ready or close as `wontfix`; unresolved questions stay for a grilling thread |
| `ready-for-agent`          | An agent                | Claim or resume the ticket                                                                                |
| `grilling`                 | An open grilling thread | Settle the remaining questions                                                                            |
| `in-progress`              | The working agent       | Merge, escalate, or have its stale claim checked                                                          |
| `planning`                 | A planner               | File tickets and close its tracking issue                                                                 |
| `research`                 | A researcher            | Publish findings                                                                                          |
| `review-blocked`           | Review workflow         | Obtain the missing review before merging                                                                  |

## Escalation and hand-back

`queue.sh escalate` adds `needs-triage`, removes `ready-for-agent` and `in-progress`, and requires a comment beginning `## Needs you`. The comment states the decision or action, options and consequences, recommendation, and evidence (PR or failed check). It reads on its own from GitHub.

Triage resolves the question and folds the answer into the ticket. Work-ticket and land immediately launch the dedicated T3 flow in `.agents/skills/triage/SKILL.md`. Its queue helpers reserve a slot (`grill-start`, at most 10 open grills), record the thread link (`grill-launched`), or clear a failed or confirmed missing thread (`grill-clear`). When ready, rewrite the body, post one resolution comment, remove `grilling`, replace `needs-triage` with `ready-for-agent`, and archive the thread. The tick resumes prior work using claim history and the latest trusted comments. An unresolved ticket stays in `needs-triage` for a grilling thread.

A stale claim is checked through T3, then refreshed, woken, or released; age alone is not an escalation. Escalations do not cap implementation or planning.

## Completed specs

`queue.sh parent-done <child>` closes a parent once all children are closed, with one comment listing the children. Repeating it changes nothing.
