# Principal review packet — <slice ID>

## Identity

Repository: <verified owner/name>
PR: <actual URL, or explicitly LOCAL_ONLY>
Slice/spec: <path and issue if present>
Reviewed base candidate: <full SHA>
Head candidate: <full SHA>
Effective merge base: <full SHA>
Required next action: <principal review / gate adjudication / access unblock>

Record final candidate refs in the PR body/comment after committing, not in a commit that changes the referenced head. Re-read actual PR head before submitting.

## Outcome and scope

State the single outcome. List relevant plan/ledger sections and actual changed packages. Identify generated files separately. Describe scope deviations and any remaining limitations; no deviation is approved by being written here.

## Acceptance evidence

| Invariant/criterion | Command or real-store procedure | Result | Evidence/artifact and run/build SHA |
|---|---|---|---|
| <criterion> | <actual command, not invented script> | <PASS/FAIL/NOT_RUN> | <sanitized durable pointer> |

Separate executed tests from supplied logs inspected. Mark privileged/manual tests NOT_RUN or BLOCKED until performed. Include CI run IDs, applicable tool/API versions and test environment. Note resource cleanup.

## Local pre-review

Spec review: <findings and disposition; role/session identity>
Correctness review: <findings and disposition; role/session identity>
Unresolved findings: <concrete issues, or none>
Describe sequential/self-review honestly if no independent local reviewer was available.

## Compatibility and safety

Summarize API/protocol/schema changes, migration/reader compatibility, money/setup/grouping impact, idempotency/tenant/security impact, retention impact and secrets scan. No impact is an explicit conclusion, not omitted analysis.

## Principal decision — principal/user completes externally

Verdict: APPROVED / CHANGES_REQUESTED / BLOCKED_EVIDENCE
Bound repository/PR/base/head: <exact reviewed refs>
Gate result separately accepted: <gate + evidence, or none>
Required corrections/conditions: <specific>
Authorization for next slice: <separate prompt/reference, or NONE>

An agent must not fill approval fields by predicting the principal's answer. A chat verdict is not automatically a native GitHub review.
