---
name: process-review
description: "Weekly review of how agent work went: mine T3 threads and transcripts, file one research issue and at most three follow-up tickets."
disable-model-invocation: true
---

# Process review

Owned by this repo. One pass per week, launched by the scheduled task in [the process-review doc](../../../docs/agents/process-review.md) (cadence, model, how to pause, what each measure means). The pass reads past sessions, reports what repeats, and files the strongest findings as tickets. It **never edits a skill, AGENTS.md or code**: fixes travel through tickets and the normal `work-ticket` / `land` path.

The repo is public. You publish **no free text**. Your findings are a structured file of closed choices (categories, metrics, issue numbers, proposals); `collect.mjs` validates it and writes every sentence and every figure itself. Prose you write cannot reach GitHub, because nothing but `collect.mjs` output is posted.

## 1. Collect

Read from the current `main`, not an older checkout. Put every scratch file in an OS-temp directory outside all worktrees.

```sh
VIEW=$(.agents/skills/read-main/read-main.sh | awk '$1=="main-view"{print $2}')
T=$(mktemp -d)
C="$VIEW/.agents/skills/process-review/collect.mjs"
node "$C" --repo "$VIEW" --days 7 > "$T/week.md"
node "$C" --repo "$VIEW" --all  > "$T/all.md"
node "$C" --repo "$VIEW" --days 7 --format json > "$T/week.json"
node "$C" --repo "$VIEW" --all --format json > "$T/all.json"
```

Use the pinned Node (`. scripts/pinned-node.sh` from a checkout, or `.nvmrc`). The collector opens the T3 database read-only, reads Claude Code and Codex transcripts without writing, and exits non-zero rather than print anything that could carry source text.

Done when the four files exist and every section is either a table or `unavailable (<reason>)`. A non-zero exit means the privacy rule refused the output: file the research issue with the title and the words `collector refused`, the exit code and nothing else, and end the run.

## 2. Compare

Read the previous report: `gh issue list --label research --state all --search "process review in:title" --limit 3 --json number,title,createdAt`, then its body. A finding is **repeated** when last week's tables show it too. Each table row you cite comes from `week.md`, `all.md` or the previous report, with its number.

The collector states its own **scope** (Coverage and Gaps): quote it beside any total that you compare with an older figure, and name what the older figure counted differently. A figure that cannot be reproduced is reported as not comparable, never adjusted to match.

Done when each measure in `week.md` has a trend against the previous report, or says there is none yet.

## 3. Filter

A finding earns a place only if it is **high-signal** (a table row far from its target or from the previous week), **repeated** (two weeks running, or across providers or roles) or **high-impact** (money, hours, failed work). One-offs are dropped. Check **factual drift** every run and always report it: each claim `AGENTS.md`, the skills and `docs/agents` make about behaviour that a table now contradicts (a schedule said to be off that the Scheduled tasks table shows enabled for the same purpose, a share target against the achieved share, a skill described as used that has no loads). A section that reads `unavailable` is a gap, never a zero: do not turn it into a finding about the measure.

Prefer a **deterministic check** over a new written rule: a script, lint rule or gate beats a sentence in a skill (`retro` has the same bias). Rank the survivors; keep at most the top three for tickets.

Done when every survivor names its evidence metrics, its repeated or impact reason, and the proposal it carries.

## 4. Record

Write the findings to `$T/findings.json`. Nothing else you write is published; the file is exactly this shape, and every value comes from the lists in `findings.mjs` (categories, metrics, proposals) or is an integer:

```json
{
  "findings": [
    {
      "category": "review-churn",
      "evidence": [{ "metric": "review-threads-per-pr-max", "window": "week" }],
      "issues": [134],
      "repeated": "yes",
      "impact": "hours",
      "proposal": "add-script-check",
      "skills": []
    }
  ],
  "tickets": [{ "finding": 1, "label": "ready-for-agent" }]
}
```

- `category`, `metric`, `proposal`: pick from `categories`, `metrics` and `proposals` in [findings.mjs](findings.mjs). If none fits, the finding does not fit the format: drop it, or file it as `investigate` under the nearest category.
- `window` is `week` or `all`; the collector reads the figure from `week.json` or `all.json`, so you never type a number.
- `issues` are `#<n>` references (at most five), `skills` are this repo's skill names (at most three), `repeated` is `yes`, `no` or `no-previous`, `impact` is `money`, `hours`, `failed-work` or `none`.
- `tickets` names at most three findings by position. `ready-for-agent` needs a proposal other than `investigate`; use `needs-triage` otherwise (the nightly triage settles it). `ready-for-human` is not a label here.

Validate, then render and post. A non-zero exit from `--check` means a value is outside the format: fix the file, never loosen the check.

```sh
node "$C" --repo "$VIEW" --check "$T/findings.json"
R="--week-report $T/week.json --all-report $T/all.json"
{ cat "$T/week.md"; node "$C" --repo "$VIEW" --render-findings "$T/findings.json" $R; } > "$T/report.md"
gh issue create --title "process review: $(date +%F)" --label research --body-file "$T/report.md"
```

For each ticket `N` (1 to 3), search open tickets first and extend an existing one instead of filing a duplicate, then file from the generated parts, with the research issue number as `RES`:

```sh
node "$C" --repo "$VIEW" --render-ticket "$T/findings.json" --ticket N --research RES --part title $R
node "$C" --repo "$VIEW" --render-ticket "$T/findings.json" --ticket N --research RES --part label $R
node "$C" --repo "$VIEW" --render-ticket "$T/findings.json" --ticket N --research RES --part body  $R > "$T/ticket-N.md"
gh issue create --title "<title part>" --label "<label part>" --body-file "$T/ticket-N.md"
```

Comment the follow-up links on the research issue as bare `#<n>` numbers, close it, and remove `$T`, following [Where records live](../../../docs/agents/issue-tracker.md#where-records-live).

Done when the research issue is closed with the follow-up links, `--check` passed, and `$T` is gone.

## Limits

Finish inside two hours of wall clock. If a command stalls, post the research issue from `week.md` with an empty findings file (`{"findings":[],"tickets":[]}`), say nothing else, and end.
