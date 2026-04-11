---
name: test
description: "Test execution and result interpretation for the tester agent. Defines when to run incremental vs full suite and how to compress output."
---

## Test execution rules

### When to run incremental (`scripts/test-changed.sh`)
- After each `implementer` step during a build
- After a `debugger` fix is applied
- For `/fix` command verification

### When to run full suite (`scripts/test-all.sh`)
- Final verification before a step is marked complete in a `/build`
- Pre-merge gate (triggered by `pre-merge-verify` hook)
- Before every `/release`
- After any change to shared utilities, types, or config

### Execution

```bash
# Capture output without flooding the context
TMPFILE=$(mktemp)
bash scripts/test-changed.sh 2>&1 | tee "$TMPFILE"
```

## Output compression

Never return raw test output. Always return a summary in this format:

```
Test run: <incremental|full>
Result: <PASS|FAIL>
Counts: <N> passed, <N> failed, <N> errors, <N> skipped
Duration: <Ns>

Failing tests:
- <TestName>: <one-line error>
- ...

Root cause hypothesis: <one sentence if discernible>
Recommended action: <fix X in Y | escalate to debugger | investigate Z>
```

If all tests pass:
```
All <N> tests passed. (<Ns>)
```

## Framework-specific result parsing

### Jest / Vitest
- PASS/FAIL lines: `grep -E "^(PASS|FAIL) "`
- Summary: `grep -E "Tests:.*passed"`

### pytest
- Summary: `grep -E "passed|failed|error" | tail -1`
- Failures: `grep -A3 "FAILED"`

### cargo test
- Summary: `grep -E "^test result"`
- Failures: `grep "^FAILED"`

### go test
- Summary: `grep -E "^(ok|FAIL)"`

## Failure triage

After identifying failing tests, assess:

1. Is the failure in the code just changed? → likely a direct bug, return to implementer
2. Is the failure in unrelated code? → possible regression, flag to architect
3. Is it a flaky test (passes on retry)? → note as flaky, do not block on it
4. Is the error cryptic or cross-module? → recommend debugger escalation
