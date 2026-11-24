# Process review

A weekly T3 task reviews how agent work went. It runs the collector in [`.agents/skills/process-review/`](../../.agents/skills/process-review/SKILL.md), files one `research` issue holding the dated tables and findings, and files at most three follow-up tickets. It never edits a skill, `AGENTS.md` or code. The collector is the only reader of past sessions; the model interprets its tables.

## Schedule

Weekly, Monday 06:00 local time, independent of the tick. The scheduler API takes no model or effort fields, so the task prompt routes the run like the [nightly triage](nightly-triage.md): the scheduled session loads `read-main` and `delegate`, launches one general child on the first target of `bash "<read-main path>/.agents/skills/delegate/route.sh" plan` with its returned options (a workhorse-tier model at `high` effort), and tells it to read and follow `.agents/skills/process-review/SKILL.md` from the read-main view. The child stops after two hours of wall clock.

To recreate the schedule, call `schedule_task` with `freshSession: true`, `bindToCurrentThread: false` and `schedule: {type: "fixed_time", timeOfDay: "06:00", weekdays: [1]}`. To pause it, disable that task (`schedule_task` with its `scheduledTaskId` and `enabled: false`). Use this prompt:

> Run the weekly process review for Scott-Poole/card-game. Load read-main and use its read-only checkout, then load delegate and launch one general child on the first target from `bash "<read-main path>/.agents/skills/delegate/route.sh" plan` with its returned options. Tell it to read `.agents/skills/process-review/SKILL.md` in that checkout and follow it exactly, passing it the checkout path. Await its outcome and report failures; do not substitute another model. Do not edit the primary checkout.

## Measures

`node .agents/skills/process-review/collect.mjs [--days N | --all] [--format markdown|json]` prints one section per measure. Defaults read `~/.t3/userdata/statev2.sqlite`, `~/.claude/projects` and `~/.codex/sessions`; flags override each path. A source that is missing or unreadable turns its sections into `unavailable (<reason>)`; the rest still print.

Windows: runs by request time, commands and skill loads by their own time, threads (roles, PRs, peaks, turns) by creation time, Claude cost by a session's last event.

| Section             | Reads                                                               | Measure                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage            | all sources                                                         | what each source held, and how many transcripts T3 does not know (read in full; the others give only cost and last-seen time); the standing gaps                                        |
| Skills              | T3 `Skill` and read items; transcripts outside T3; `SKILL.md` files | loads and distinct threads per skill and provider, zero-use skills, skills one provider loads, model-invocable description characters every child carries                               |
| Mix                 | T3 threads and runs                                                 | threads, runs and run minutes per role (implement, review, plan, tick, triage, audit, research, read-only, interactive) and provider; `claudeShare` achieved against `tick/config.json` |
| Runs and failures   | T3 runs, error items                                                | runs, failures and duration per provider, failure classes, models                                                                                                                       |
| Review rounds       | T3 threads, PR links, lineage                                       | threads per PR (own PR links, else the nearest ancestor's), review threads per PR, the five busiest PRs                                                                                 |
| Gate cost           | T3 commands, Claude `Bash` calls                                    | runs that start a shell segment with `pnpm check`, failed share, wall clock, runs per PR, and the looser count of commands mentioning it anywhere                                       |
| Context and turns   | T3 provider turns; Claude transcripts outside T3                    | peak tokens per thread by provider, threads at 200k or half their window, runs and turns per implement thread, tick runs that launched nothing and their cost                           |
| Claude cost         | Claude `cost-state` records                                         | USD per role and model                                                                                                                                                                  |
| Codex limit samples | Codex rate-limit samples                                            | samples, samples at 100%, days at the limit                                                                                                                                             |
| Hygiene             | `git worktree` and branch lists, T3 threads, database size          | leftover worktrees and local branches (merged, dirty), unarchived threads, database size                                                                                                |
| Scheduled tasks     | T3 scheduled tasks                                                  | schedule kind, mode, enabled, run count and last status, for factual drift                                                                                                              |

A role comes from a thread's first message and creator, reduced to a label inside the reader; the text is never kept. Roles are a heuristic: threads that match none count as `other` and are reported.

## Privacy

The repository is public, so output is aggregate by construction. Readers reduce source text to closed vocabularies (providers, statuses, roles, the repo's own skill names, integer PR numbers, short tokens such as failure classes and model ids; anything else becomes `other`). The renderer then rejects any string that is long, multi-line or matches a path, URL, e-mail, UUID, long hex id, `.sqlite`/`.jsonl` name or non-ASCII text, and exits non-zero without printing. `collect.mjs --check FILE` applies the same rules to text the review writes itself. `test-collect.mjs` plants source text, paths and titles in fixtures and asserts none reaches the output, and that the source database is unchanged.

## Regression suite

`pnpm test:process-review` builds a synthetic T3 database, transcripts and git repo, runs the CLI, and checks every section and the privacy rule. Run it after changing the collector.
