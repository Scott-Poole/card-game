---
name: validate
description: Validate a code change locally before opening or updating a PR. Use after implementation or review fixes, before pushing, and when reporting that a feature works.
---

# Validate the change

Own the evidence before GitHub runs. A green pipeline confirms local work; it does not replace it.

1. Read the acceptance criteria and inspect the final diff. Map each changed behavior to a check or a user interaction. Check for unintended files, generated output and unrelated changes.
2. Use the pinned Node and pnpm versions and install with the frozen lockfile. Run relevant tests while implementing, then run the full pnpm check on the final tree. This command sets CI mode locally. Hooks reinforce the workflow; invoke the commands yourself when hooks are unavailable.
3. For a browser-visible change, start the real app and use Playwright or available browser automation to perform the user's task. Exercise the changed flow, relevant failure states and reload/reconnect behavior where applicable. Inspect visible results and browser errors. Automated assertions alone do not replace this interaction pass.
4. For a change without a browser surface, exercise its actual public interface instead: decoder input/output, CLI invocation, HTTP request, hook or other changed boundary. Say why browser validation does not apply; do not invent a UI to test tooling.
5. Fix failures and repeat the affected checks. If CI later exposes an environment difference, reproduce it locally and improve local validation alongside the fix.
6. Before opening or updating a PR, record commands, results, interactions performed, any unverified acceptance criterion, and git diff --stat. Claim completion only when every applicable criterion has evidence.

Done when the final tree passes the full local gate, changed behavior has been exercised through its public interface, and the PR evidence reflects what actually ran.
