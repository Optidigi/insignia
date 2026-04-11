---
name: fix
description: "Lightweight path for small bugs or isolated changes. Skips full architect planning to minimise overhead."
arguments:
  description: "The bug or change to apply."
---

This is the fast path. Follow these steps directly:

1. Spawn `researcher` (Haiku) to locate the relevant file(s) and summarise
   the affected code. Keep the research brief focused on the bug description.

2. Write a one-paragraph plan: what changes, in which file, and why.
   No `plan.md` needed for small fixes.

3. Spawn `implementer` (Sonnet) to apply the change.

4. Spawn `tester` (Haiku) with `scripts/test-changed.sh` to verify.
   If tests fail, spawn `debugger` (Sonnet) and loop back to `implementer`.

5. Optionally spawn `reviewer` (Sonnet) if the change touches security-
   sensitive or performance-critical code.

Do not use Opus. Do not load the full architect skill. Keep it lean.
