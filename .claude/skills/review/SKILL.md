---
name: review
description: "Code review criteria and checklist for the reviewer agent. Defines severity thresholds and what constitutes a BLOCKER vs WARNING vs SUGGESTION."
---

## Severity definitions

**BLOCKER** — The code cannot be merged as-is. Examples:
- Security vulnerability (SQL injection, exposed secret, missing auth check)
- Data loss risk (destructive operation without guard, unhandled migration)
- Logic error that causes incorrect behaviour in the primary use case
- Broken error handling that silently swallows failures
- Type error that will cause a runtime crash

**WARNING** — Should be addressed before or shortly after merge. Examples:
- Missing test coverage for a non-trivial code path
- Performance issue that will manifest under realistic load
- Inconsistent naming or style that will confuse future readers
- Incomplete documentation on a public API
- Deprecated API usage with a known migration path

**SUGGESTION** — Optional improvement. Examples:
- Alternative implementation that is slightly cleaner
- Refactoring opportunity not in the current scope
- Additional test case that would be nice to have
- Style preference where multiple approaches are equally valid

## Review checklist

Work through this list in order. Stop at each BLOCKER and flag it before
continuing — do not bury BLOCKERs in a list of SUGGESTIONs.

### Correctness
- [ ] Does the code do what the plan step says it should do?
- [ ] Are edge cases handled? (empty input, null, zero, large values)
- [ ] Are errors propagated correctly? No silent swallowing.
- [ ] Are async operations awaited? No floating promises.
- [ ] Are race conditions possible in concurrent paths?

### Security
- [ ] No hardcoded secrets or credentials
- [ ] All external input is validated before use
- [ ] SQL / queries use parameterisation
- [ ] Auth checks are present where required
- [ ] No sensitive data in logs or error messages
- [ ] File paths are sanitised before use

### Performance
- [ ] No N+1 query patterns in loops
- [ ] Database queries use indexes where available
- [ ] No unbounded loops on user-supplied data
- [ ] No unnecessary re-computation inside render/request paths
- [ ] Caches/memoisation used where the cost is justified

### Style and maintainability
- [ ] Naming is clear and consistent with the surrounding codebase
- [ ] No magic numbers or unexplained constants
- [ ] Public functions have doc comments
- [ ] No dead code or commented-out blocks

### Test coverage
- [ ] New happy-path behaviour has at least one test
- [ ] New error/edge-case behaviour has at least one test
- [ ] Existing tests have not been weakened or deleted without reason

## Output format

```
## Review: <step name or file list>

### BLOCKERs
- [file:line] <description and why it is a blocker>

### WARNINGs
- [file:line] <description>

### SUGGESTIONs
- [file:line] <description>

### Verdict
LGTM | BLOCKED (N blockers must be resolved)
```

If no issues: `LGTM — all checklist items passed.`
