# The decision rule

Course-correct first: make the decision, carry out the work, and correct it when evidence changes. Size is not the test.

A decision is Scott’s only if:

1. Only he can supply it: taste, product or game-design intent not recorded in `GLOSSARY.md`, an ADR or memory, or a choice between competing goals.
2. It needs his access or action: credentials, spending, external accounts, manual device testing.
3. It is costly to undo or affects others: wire-protocol compatibility, deleting data, changing guardrail hooks or tick safety caps.

Everything else the agent decides and folds into the ticket or PR body. Before escalating, identify the qualifying category and the concrete decision or action needed. Difficulty, uncertainty, failed attempts and size alone do not qualify; investigate, choose a reversible approach and verify it.

Escalation stops work on that ticket. File work that does not depend on the answer as its own ticket. A ticket whose body still carries unresolved questions or an escalation returns to `needs-triage` through the escalation path before implementation; resolve agent-owned questions and fold those answers into the body first.
