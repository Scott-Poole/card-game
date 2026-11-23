# Nightly triage

Tickets have three readiness states: ready-for-agent, needs-triage, and backlog.
Backlog is parked on purpose: never settle, grill, claim, promote, or close it
automatically, even with conflicting readiness labels. Only Scott or a thread
he directs replaces backlog with needs-triage or ready-for-agent. There is no
automatic expiry. Nightly reports only its count, without reading or summarising
backlog tickets.

The nightly T3 task runs at 02:00 local time with a fresh session. Its entry point
is [.agents/skills/triage/nightly.md](../../.agents/skills/triage/nightly.md).
It settles trusted-author needs-triage tickets oldest first and sends decisions
reserved for Scott to dedicated grilling threads, capped at 10 open grills.

The finder uses paginated GitHub queries and the landed tick trust policy. It emits
TRIAGE issue numbers and CHECK entries for grilling reservations. T3 verifies those
threads, then supplies run-local states through `--grills` to produce STALE entries.
This split keeps T3 access in the agent and deterministic filtering in the tested
CLI. Unknown states fail closed. No ticket body scanning happens in the script.

The scheduler API does not expose model or effort fields. The task prompt therefore
routes execution to `claude.workhorse` with its catalog options through delegate; the scheduled session
only orchestrates that run. Empty finder output ends before delegation.

To recreate the schedule, call `schedule_task` with `freshSession: true`,
`bindToCurrentThread: false`, and `schedule: {type: "fixed_time", timeOfDay: "02:00"}`.
Use this prompt:

> Run nightly ticket triage for Scott-Poole/card-game. Load read-main and use its
> landed read-only checkout. Run node scripts/triage-finder.mjs there first. Empty
> stdout ends with zero launches after querying and reporting only the backlog count
> per nightly.md step 1. Otherwise load delegate and launch
> one shared, read-only general child using the first target from `bash "<read-main path>/.agents/skills/delegate/route.sh" plan`
> with its returned options. Give it the checkout path and tell it to follow .agents/skills/triage/nightly.md
> exactly. Await its outcome and report failures; do not substitute another model.
> Do not edit the primary checkout.
