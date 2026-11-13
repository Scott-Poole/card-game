# Delegation log

One row per delegated task, appended by the orchestrating session after it has verified the result (see the `delegate` skill). `/retro` reads this to retune the tier table in `.agents/skills/delegate/SKILL.md`.

- **Outcome**: `pass` (passed verification first try), `fixed` (orchestrator patched it), `retried` (re-briefed at same tier), `escalated` (moved up a tier), `failed`.
- **Rounds**: review or retry rounds before it landed.

| Date | Task | Tier | Provider / model / effort | Outcome | Rounds | Notes |
|---|---|---|---|---|---|---|
