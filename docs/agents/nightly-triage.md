# Nightly triage

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
routes execution to Claude Sonnet 5.5 high through delegate; the scheduled session
only orchestrates that run. Empty finder output ends before delegation.

Schedule ID: `scheduled-task:552d0780-68b7-4715-82f1-2e817a0c7bcb`.
Next run when created: 2026-11-23 10:00 UTC (02:00 Pacific).
