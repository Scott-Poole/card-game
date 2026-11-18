---
name: research
description: Investigate a question against primary sources and publish cited findings to a GitHub research issue. Use for research requests or delegated reading legwork.
---

# Research

1. Read the supplied GitHub issue, or create one for the question in this repo. Ensure it has the `research` label (create the label if absent). Research issues are human-directed; leave `ready-for-agent` off them so the tick does not dispatch them.
2. Load [delegate](../delegate/SKILL.md). Launch a background research agent with a fresh context, the question, issue number and checkout path. Allocate a unique OS-temp directory outside all worktrees for a backup copy and pass its absolute path to the child. It investigates primary sources (official docs, source code, specs, first-party APIs), follows each claim to its owner, and writes cited findings to `.scratch/research/<issue>.md`. The child edits only that scratch file in its own worktree, copies it to the supplied backup path, and returns both absolute paths before exiting. Keep working while it reads.
3. Verify the cited findings in the child's checkout, or the backup if the checkout has been removed. Post their complete content as comments on the research issue using `gh issue comment <n> --body-file <file>`. Split at paragraph boundaries into comments of at most about 60,000 characters. Number chunks (1/N) and retain each successful comment URL in the temporary transfer manifest. On retry, inspect the issue comments and resume at the first missing chunk; check every write succeeded before cleanup.
4. Act on the findings: file implementation issues referencing `Refs #<research issue>`, or conclude that no implementation is needed. Post a resolution that says **research complete**, states the conclusion, links the findings comments and any implementation issues, and mentions the scratch findings were transferred. Close the research issue.
5. Remove the scratch file and temporary backup/manifest after transfer and record the run per delegate. If posting fails, retain the scratch file and leave the issue open for retry.

Follow [Where records live](../../../docs/agents/issue-tracker.md#where-records-live). Done when the complete findings and conclusion are on GitHub, any implementation work has tickets, the research issue is closed, and scratch is cleaned up.
