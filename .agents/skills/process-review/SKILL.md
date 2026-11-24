---
name: process-review
description: "Weekly review of how agent work went: mine T3 threads and transcripts, file one research issue and at most three follow-up tickets."
disable-model-invocation: true
---

# Process review

Owned by this repo. One pass per week, launched by the scheduled task in [the process-review doc](../../../docs/agents/process-review.md) (cadence, model, how to pause, what each measure means). The pass reads past sessions, reports what repeats, and files the strongest findings as tickets. It **never edits a skill, AGENTS.md or code**: fixes travel through tickets and the normal `work-ticket` / `land` path.

The repo is public. Everything you write on GitHub carries aggregate counts, ratios, skill names, roles, providers and `#<n>` references, and nothing else: no prompt or transcript text, thread titles, local paths or URLs. `collect.mjs` enforces this for its own tables; step 4 enforces it for yours.

## 1. Collect

Read from the current `main`, not an older checkout. Put every scratch file in an OS-temp directory outside all worktrees.

```sh
VIEW=$(.agents/skills/read-main/read-main.sh | awk '$1=="main-view"{print $2}')
T=$(mktemp -d)
node "$VIEW/.agents/skills/process-review/collect.mjs" --repo "$VIEW" --days 7 > "$T/week.md"
node "$VIEW/.agents/skills/process-review/collect.mjs" --repo "$VIEW" --all  > "$T/all.md"
```

Use the pinned Node (`. scripts/pinned-node.sh` from a checkout, or `.nvmrc`). The collector opens the T3 database read-only, reads Claude Code and Codex transcripts without writing, and exits non-zero rather than print anything that could carry source text.

Done when both files exist and every section is either a table or `unavailable (<reason>)`. A non-zero exit means the privacy rule refused the output: file the research issue with the title and the words `collector refused`, the exit code and nothing else, and end the run.

## 2. Compare

Read the previous report: `gh issue list --label research --state all --search "process review in:title" --limit 3 --json number,title,createdAt`, then its body. A finding is **repeated** when last week's tables show it too. Each table row you cite comes from `week.md`, `all.md` or the previous report, with its number.

The collector states its own **scope** (Coverage and Gaps): quote it beside any total that you compare with an older figure, and name what the older figure counted differently. A figure that cannot be reproduced is reported as not comparable, never adjusted to match.

Done when each measure in `week.md` has a trend against the previous report, or says there is none yet.

## 3. Filter

A finding earns a place only if it is **high-signal** (a table row far from its target or from the previous week), **repeated** (two weeks running, or across providers or roles) or **high-impact** (money, hours, failed work). One-offs are dropped. Check **factual drift** every run and always report it: each claim `AGENTS.md`, the skills and `docs/agents` make about behaviour that a table now contradicts (a schedule said to be off that the Scheduled tasks table shows enabled, a share target against the achieved share, a skill described as used that has no loads).

Prefer a **deterministic check** over a new written rule: a script, lint rule or gate beats a sentence in a skill (`retro` has the same bias). Rank the survivors; keep at most the top three for tickets.

Done when every survivor names its evidence row, its repeated or impact reason, and the check it proposes.

## 4. Record

Write the research issue body to `$T/report.md`: the dated `week.md` tables, a short comparison with the previous report and `all.md`, the findings, and the drift list. Hold it to the privacy rule, then post:

```sh
node "$VIEW/.agents/skills/process-review/collect.mjs" --check "$T/report.md"   # exit 1 means rewrite it
gh issue create --title "process review: $(date +%F)" --label research --body-file "$T/report.md"
```

File at most **three** follow-up tickets, strongest first, per [to-tickets](../to-tickets/SKILL.md): each cites the evidence rows by number, states acceptance criteria that a command can check, and says `Refs #<research issue>`. Label a ticket `ready-for-agent` when it carries acceptance criteria and `needs-triage` otherwise (the nightly triage settles it); `ready-for-human` is not a label here. Search open tickets first and extend an existing one instead of filing a duplicate. Run `--check` on each body before `gh issue create`.

Comment the follow-up links on the research issue, close it, and remove `$T`, following [Where records live](../../../docs/agents/issue-tracker.md#where-records-live).

Done when the research issue is closed with the follow-up links, every body passed `--check`, and `$T` is gone.

## Limits

Finish inside two hours of wall clock. If a command stalls, record what you have as the research issue, say what is missing, and end.
