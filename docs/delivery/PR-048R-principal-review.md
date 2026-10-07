# PR #48 — external principal rereview

**Verdict: APPROVED for normal merge at the corrected head.**

Exact binding:
- base/effective merge base `4bba14fb4415815557ffa5f1e600427a62128489`
- approved head `125e6d452d713acc9ce7eb741c2506f25857cb8f`
- approved tree `31ccad58a7a1941fce17451d83ca7326ac712ecc`
- correction parent `2d0b5177add9b412a8e1f9c43309ae6af04f1e1e`
- final-head workflows 11/11 SUCCESS, all attempt 1
- native GitHub reviews none
- fresh GPT-6.1-sol/high Spec/correctness CLEAR
- fresh GPT-6.1-sol/high Standards/security CLEAR

This approval supersedes the prior CHANGES_REQUESTED verdict only for the exact corrected head/tree.

## Correction accepted

The M5-017R correction is exactly one commit beyond the prior reviewed head.

Application, adapter and SQL now classify legacy ResourcePublication future timing against completed `receivedAt`, while preserving request-start `observedAt` for provenance/freshness.

No tolerance was introduced.

Accepted semantics:
- true + publishDate <= receivedAt: not future solely by time;
- true + publishDate > receivedAt: future/scheduled blocker;
- equality is accepted;
- legacy false remains conservative unsupported/non-effective blocking evidence and is not described as ResourcePublicationV2 staged state.

Provider GraphQL documents/request sequence remain unchanged. Historical v1/v2 source and semantics remain unchanged.

## Exact sealed-response replay

The exact seven captured restore responses replay through corrected production source entirely in memory.

Result:
- RESTORED;
- semantic readback equals original before;
- effective Publication set `339456917787`;
- exact original ACK facts/timestamps retained;
- compensation attempts 0;
- external requests 0;
- ambient fetch attempts 0;
- sealed canonical bytes unchanged.

Historical live execution remains CLOSED/SEALED and STOPPED/CONFLICT. It is not rewritten into a PASS.

## Provider evidence accepted

The original real v3 lifecycle established:
- acquire HELD;
- exact persisted hold;
- genuine fresh-process observe HELD;
- restore ACKNOWLEDGED;
- exact original effective membership returned;
- all provider writes settled;
- final fixture archived/effectively unpublished;
- all 38 actual provider requests durably accounted.

The corrected replay resolves the only known production classification defect without another provider operation.

Therefore no further availability-hold live lifecycle is required before moving to remaining M5 work.

## Validation

Accepted:
- PostgreSQL 18.6: 171 tests;
- application-focused: 85;
- Shopify v3: 58;
- stress: 400/400;
- renderer negative control;
- query-plan/migration controls;
- full root;
- 11/11 natural exact-head workflows, attempt 1;
- both fresh full-source reviews CLEAR.

## Remaining platform residuals

These are explicit limitations, not blockers to the v3 implementation:
- hidden non-effective configured intent is not generically discoverable;
- scheduled publishing is not live-qualified;
- provider observations are not atomic;
- Shopify exposes no native CAS for this operation.

Visible scheduled/future evidence remains fail-closed.

## Disposition

PR #48 may be normally merged once taken out of draft, with the approved head unchanged.

Availability mechanics are considered closed unless later feature integration produces a genuinely new defect.

Next authority is M5-018.
