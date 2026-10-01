# Insignia M5-003R2 handoff

This package contains the external principal rereview and one bounded correction on existing PR#29. It is not a merge approval or an M5-004/M6 brief.

1. Verify `MANIFEST.sha256` from this directory (`sha256sum -c MANIFEST.sha256`).
2. Read `PR-029R-principal-review.md` for the exact candidate, accepted corrections, remaining finding and evidence limits.
3. The owner forwards `OWNER-LAUNCH.txt` with this package to authorize the scoped local correction.
4. The local agent follows `M5-003R2-TRANSPORT-DISPATCH-CLOSURE.md` and stops for principal rereview.

## Suggested skills

Reuse repository-pinned `code-review`, `diagnosing-bugs`, `tdd` with its tests/mocking references, `writing-for-agents` and `handoff`. Project authority overrides generic skill defaults. No additional skill installation or product interview is required for this correction.

## Evidence

`evidence/README.md` explains the reproducible diagnostic and its limits. It executes fixed, hash-verified source with synthetic HTTP, not the full database transaction. Permanent regressions must exercise the corrected production public seams. The original observation and UNLISTED fixes pass the included controls; the remaining failure is after the caller guard, inside transport preparation.

The package has not been committed, posted as a native review or merged. No Shopify/provider operation was performed.
