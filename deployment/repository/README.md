# Main branch checks

The owner accepted the 15 October proportionality audit. `main-protection.json` is the small intended repository rule, separate from product security or deployment authority.

Read actual current protection/rules before any separately needed change; preserve newer rules. The original proportionality audit and initial application sequence are historical, not an instruction to reapply protection during cleanup. Normal integration must satisfy the repository’s actual required checks and restrictions.

Use the app-bound `checks` request form alone; do not also send the legacy `contexts` field. The historical first request containing both forms was rejected with422; its readback then confirmed no protection had been created.

Require `foundation`, `durable-core` and `runtime` from GitHub Actions app15368 (independently read from existing check runs), including for administrators. No human approval count, code-owner approval or linear-history rule is introduced. Force pushes and branch deletion are disallowed. `strict:false` avoids automatic rebuilds solely for a newer base; the lead still verifies the live base, reviewed head/effective merge-base and relevant integration evidence before merging.

All three PR workflows must be selected regardless of changed paths. Their narrow status-document route validates actual Git changes and explicitly reports that behavioral suites were not selected. Unknown, authority, executable or workflow edits keep full checks. A successful job is evidence for its selected route, not a claim that skipped suites ran.

If a genuinely required protection update is authorized, qualify its exact intended delta and current rule first; use `main-protection.json` only when it still matches that reviewed intent. This cleanup does not request a protection mutation.

Read protection back and compare the three app-bound checks, administrator enforcement and absence of human-review requirements. Preserve the observed response in the existing integration record without credentials. A failed or ambiguous write must be reconciled by reading before another write. Do not disable protection to get a failed candidate through.

This file does not authorize billing, runtime deployment, additional resources, paid services or changes outside this repository.
