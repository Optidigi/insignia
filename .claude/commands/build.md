---
name: build
description: "Main entry point for any feature, app, or non-trivial development task. Hands control to the architect agent, which plans and delegates autonomously."
arguments:
  description: "What to build. Be as specific or as broad as you like — the architect will scope it."
---

Invoke the `architect` agent with the following brief:

**Task:** $description

The architect will:
1. Load the `architect` and `stack` skills.
2. Spawn `researcher` to explore existing code.
3. Assess complexity and optionally escalate to `opus-decision`.
4. Write a structured plan to `plan.md`.
5. Dispatch `implementer`, `tester`, and `reviewer` in sequence.
6. Loop until all steps pass review and tests are green.
7. Run a final full-suite test and full-diff review before marking complete.

You do not need to intervene. The architect will surface questions only when
a decision is genuinely irreversible and ambiguous.
