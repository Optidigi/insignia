# M5-017R — ACK completion-time publication classification correction

## Scope

Correct PR #48 only.

LOCAL/OFF-STORE ONLY.

No Shopify/Admin/Partner/browser/credential/CLI/provider request.
No fixture/product/publication mutation.
No new live run.

Preserve the sealed M5-017 raw run byte-for-byte.

## 1. Timing semantics

Keep both:
- `observedAt`: conservative observation/request-start provenance;
- `receivedAt`: completed observation/receipt endpoint.

Do not redefine `observedAt`.

For legacy ResourcePublication timing classification in complete snapshots and mutation acknowledgements, compare publication timing to `receivedAt`, not `observedAt`.

No tolerance.

Exact rule for true legacy entries:
- `isPublished === true && publishDate > receivedAt` => future/scheduled blocker;
- `isPublished === true && publishDate <= receivedAt` => not a future schedule solely from time.

This must fix the canonical live ACK:
`12:09:54.968Z < 12:09:56.000Z < 12:09:57.978Z`
so it qualifies on timing.

## 2. Legacy ResourcePublication semantics

The production document uses legacy ResourcePublication.

Do not treat `isPublished=false` as if it were ResourcePublicationV2 staged state.

Shopify's legacy contract says false means neither published nor scheduled.

Choose a fail-closed treatment and document it accurately:
- it may remain a blocking non-effective/unsupported record;
- but comments, test names and reports must not claim it proves a staged future publication.

Do not weaken actual `isPublished=true + future publishDate` rejection.

Do not change to ResourcePublicationV2; prior live evidence showed that surface does not cover the hidden third-party Publication.

## 3. Application helper

Update the shared v3 timing helper so snapshots and ACK qualification use the same completed-observation endpoint.

Recommended shape:
- function accepts `receivedAt` / completion endpoint explicitly;
- all callers use the same rule;
- raw evidence remains unchanged.

`validAvailabilityV3` must recompute `visibleScheduledOrStaged` using the corrected completed-observation rule.

`availabilityV3AcknowledgementQualified` must use the corrected rule.

Any naming/comment concerning false legacy records must be corrected.

## 4. Adapter

No provider documents or request sequence should change.

Restore behavior with the exact canonical case becomes:
- ACK structurally valid;
- full readback sameAvailabilityV3(before);
- full readback qualified;
- ACK timing qualified;
- result RESTORED.

Compensation remains unattempted.

Acquire/compensation qualification uses the same corrected helper.

No retry behavior changes.

## 5. SQL parity

Correct `m5_v3_ack_qualified` and `m5_v3_snapshot` to use `receivedAt` for timing.

Application and SQL must accept/reject the same canonical controls.

Do not alter v1/v2 predicates.

No historical rewrite.

Because PR #48 is unmerged, correct the current v3 migration in this PR rather than adding a migration whose only purpose is repairing an unshipped v3 schema, unless repository migration policy explicitly requires append-only even pre-merge.

## 6. Required red/green regressions

TDD.

### Canonical live interval
ACK:
- observedAt 12:09:54.968
- isPublished=true
- publishDate 12:09:56.000
- receivedAt 12:09:57.978
=> qualified.

### Genuine future
- isPublished=true
- publishDate > receivedAt
=> unqualified.

### Equality
- publishDate === receivedAt
=> not future.

### Request-start distinction
- publishDate > observedAt but <= receivedAt
=> accepted.
Prove observedAt is still retained unchanged.

### Legacy false
Add contract-named regression showing `isPublished=false` is not asserted as ResourcePublicationV2 staged semantics. If retained as a conservative blocker, name/classify it as non-effective/unsupported blocking evidence.

### Snapshot
A complete snapshot with a true publication created during the read interval but effective by receivedAt must not be labelled future solely from request-start time.

A true publication genuinely after receivedAt remains blocking.

### SQL
Direct insert/function regressions mirror all cases above.

### Restore
Exact M5-017 raw ACK + exact full readback yields RESTORED.
No compensation dispatch.

### Safety
- actual semantic restore mismatch still takes one-shot compensation path;
- actual future schedule still prevents RESTORED;
- ambiguous restore unchanged;
- v1/v2 regression unchanged.

## 7. Exact sealed live-response replay

Build a memory-only replay from committed canonical M5-017 raw evidence.

Requirements:
- use exact preserved restore ACK Product payload and exact subsequent product/anchor readback payloads;
- corrected production factory/source;
- zero network/provider calls;
- no mutated canonical files;
- result RESTORED;
- sameAvailabilityV3(readback,before)=true;
- compensation provider attempts=0.

Record a derived replay receipt separately.

Do NOT edit:
- live register;
- live qualification;
- live adjudication raw fields;
- hold/intent/receipt bytes.

Historical raw outcome remains STOPPED/CONFLICT.

The report may add:
- `principal-correction replay: RESTORED under corrected source`
as separate post-execution derived evidence.

## 8. Documentation

Update integrated report/state to distinguish:
1. historical frozen live execution: STOPPED because frozen source misclassified ACK timing;
2. corrected local source: exact sealed live responses replay as RESTORED;
3. no second live provider execution occurred.

Do not claim the original run literally returned PASS.

Document current platform residuals unchanged:
- hidden non-effective intent not generically discoverable;
- scheduled publishing not live-qualified;
- multi-resource observations non-atomic;
- no native CAS.

## 9. Validation

Run:
- focused application v3 tests;
- Shopify v3 tests;
- activation/recovery tests;
- database v3 tests on PostgreSQL18;
- full root;
- all 11 applicable workflows;
- publication stress 400/400;
- renderer control;
- fresh full-source GPT-6.1-sol/high Spec/correctness review;
- fresh full-source GPT-6.1-sol/high Standards/security review.

Both fresh reviews must be CLEAR/no unresolved material finding.

No earlier clear review substitutes for final corrected-source review.

## 10. Handback

Return same PR #48 for principal rereview with:
- exact new head/tree;
- correction diff boundary;
- canonical live bytes unchanged;
- replay receipt;
- SQL parity tests;
- fresh reviews;
- 11/11 final-head attempt-1 CI.

Stop.

No merge.
No provider operation.
No M6/M7.
No production activation or RELEASE_BOUND.
