---
name: debug
description: "Systematic debugging protocol for the debugger agent. Defines the reproduce-isolate-inspect-diagnose-propose sequence and escalation thresholds."
---

## Protocol

Every debugging session follows this sequence strictly. Do not jump to
"Propose" without completing "Reproduce" and "Isolate" — premature fixes
address symptoms, not root causes.

### Phase 1: Reproduce

Goal: confirm you see the exact same failure before touching anything.

```bash
# Run the specific failing test
npx jest --testNamePattern="<failing test name>"
# or
pytest -k "<failing test name>" -v
# or
cargo test <test_name> -- --nocapture
```

If you cannot reproduce: report "non-reproducible" with the environment
differences you observed. Do not guess.

### Phase 2: Isolate

Goal: find the smallest unit of code that triggers the failure.

- Read the stack trace from bottom (root) to top (symptom).
- Use `Grep` to find where the failing symbol is defined and called.
- Check if the failure is input-dependent — try boundary values.
- Check if the failure is environment-dependent — env vars, timestamps, state.
- Narrow to the specific function or line where behaviour diverges from intent.

### Phase 3: Inspect

Goal: understand exactly what the code is doing vs what it should do.

- Read the relevant function(s) in full, not just the failing line.
- Check what assumptions the code makes (input shape, ordering, state).
- Check git history for recent changes to this file: `git log -10 <file>`.
- If state is involved, trace where state is initialised and mutated.
- Add targeted `Bash` instrumentation (print, log) if needed — remove after.

### Phase 4: Diagnose

State the root cause in one clear sentence:

> "The function assumes X, but Y provides Z, causing W."

Common categories:
- Off-by-one in loop bounds or index access
- Incorrect assumption about async timing (missing await, race condition)
- State mutation across test cases (missing teardown)
- Type mismatch at a boundary (string vs number, null vs undefined)
- Missing guard for empty/null input
- Incorrect import or dependency version

### Phase 5: Propose

Describe the fix precisely for `implementer`:

```
File: src/auth/session.ts
Line: 47
Change: Replace `user.id` with `user.id?.toString()` to handle cases where
        id is returned as number from the legacy endpoint.
Test: The failing test `should authenticate with numeric id` will pass.
      Add a test for the null case: `should handle missing id gracefully`.
```

## Escalation thresholds

Escalate to `opus-decision` when the bug meets ANY of:

- **Spans 3+ service boundaries** — defined as: separate top-level directories
  each containing their own package manifest (`package.json`, `pyproject.toml`,
  `Cargo.toml`, `go.mod`), OR directories under `services/`, `packages/`, or
  `apps/` in a monorepo. In a non-monorepo (single manifest): spans 3+ distinct
  domain layers simultaneously (e.g. API handler + service layer + database layer).
- The root cause is an architectural assumption, not a code error.
- Reproducing requires understanding distributed system behaviour (message queues,
  eventual consistency, network partitions).
- The fix requires a design decision (not just a line change).

In the escalation report, include:
- Reproduction steps
- Stack trace
- Your isolation findings
- Your best hypothesis for root cause
- Why you believe Opus reasoning is needed
