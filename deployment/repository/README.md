# Main branch checks

The owner accepted the 15 October proportionality audit. `main-protection.json` is the small intended repository rule, separate from product security or deployment authority.

Apply it only after the CI-routing change has passed all three exact-head workflows and merged normally. Read and preserve the current protection/rules first; do not overwrite a newer rule. The audit observed no classic protection or active branch rules. The existing CLI reports repository administration access.

Use the app-bound `checks` request form alone; do not also send the legacy `contexts` field. The first native request containing both forms was rejected with422; readback confirmed no protection had been created.

Require `foundation`, `durable-core` and `runtime` from GitHub Actions app15368 (independently read from existing check runs), including for administrators. No human approval count, code-owner approval or linear-history rule is introduced. Force pushes and branch deletion are disallowed. `strict:false` avoids automatic rebuilds solely for a newer base; the lead still verifies the live base, reviewed head/effective merge-base and relevant integration evidence before merging.

All three PR workflows must be selected regardless of changed paths. Their narrow status-document route validates actual Git changes and explicitly reports that behavioral suites were not selected. Unknown, authority, executable or workflow edits keep full checks. A successful job is evidence for its selected route, not a claim that skipped suites ran.

After the reviewed change qualifies, apply the exact file through the existing authenticated CLI:

```sh
gh api --method PUT repos/Optidigi/insignia/branches/main/protection --input deployment/repository/main-protection.json
```

Read protection back and compare the three app-bound checks, administrator enforcement and absence of human-review requirements. Preserve the observed response in the existing integration record without credentials. A failed or ambiguous write must be reconciled by reading before another write. Do not disable protection to get a failed candidate through.

This file does not authorize billing, runtime deployment, additional resources, paid services or changes outside this repository.
