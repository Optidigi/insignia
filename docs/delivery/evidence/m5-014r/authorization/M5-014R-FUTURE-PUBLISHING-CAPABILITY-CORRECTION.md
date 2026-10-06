# M5-014R — future-publishing capability vs product schedule

## Scope

Correct PR #44 only. Local/off-store only.

## 1. Qualification semantics

Distinguish:
- Publication capability: `publicationSettings[].supportsFuturePublishing`
- actual observed product schedule: `configuredIntent.scheduled`

`supportsFuturePublishing=true` remains retained and hashed configuration evidence. It must not make the product unqualified by itself.

V2 intent qualification should require:
- valid v2 snapshot;
- no actual observed scheduled/future product publication record.

Keep `scheduled.length > 0` fail-closed.

## 2. Preserve drift detection

Because publication settings remain in `configuredIntent` and `intentDigest`:
- supportsFuturePublishing changes remain intent drift;
- autoPublish changes remain intent drift;
- included-publication changes remain intent drift.

Do not remove these fields.

## 3. Scheduled publishing remains unqualified

`resourcePublications(onlyPublished:false)` is documented to include scheduled future publications. Retain non-published scheduled entries in `configuredIntent.scheduled`.

For M5-014:
- any actual scheduled entry => unqualified before hold mutation;
- schedule changes during pagination => fail closed;
- schedule drift during hold/restore => conflict.

Do not infer scheduling merely from channel capability.

## 4. Required regressions

Use TDD.

1. Online-Store-shaped publication: included, autoPublish=true, supportsFuturePublishing=true, scheduled=[], ACTIVE before, DRAFT ACK/readback with unchanged configured intent and effective membership gone; ACK/readback updatedAt may differ by one second; result HELD.
2. Capability=true with no schedule is eligible.
3. Capability value changing across observations is CONFLICT through intentDigest.
4. Actual scheduled record with supportsFuturePublishing=true remains unqualified/no write.
5. Actual scheduled record with supportsFuturePublishing=false also remains unqualified.
6. Restore of an unscheduled future-capable publication can be RESTORED when original status/effective membership and configured intent return even if timestamps differ.
7. Missing/extra effective membership remains CONFLICT.
8. Historical v1 and mixed-version SQL/recovery tests remain unchanged/green.

## 5. Documentation

Clarify that “scheduled publishing remains unqualified” means actual scheduled/staged product state, not merely a publication capable of scheduling.

## 6. Validation

Run focused application/Shopify availability tests, full root regression, PostgreSQL18 CI, 100-case publication stress, renderer negative control, fresh GPT-6.1-sol/high Spec and Standards/security reviews, and natural final-head CI.

## Boundaries

No Shopify/API/browser/credential operation.
No fixture/product/publication/scope mutation.
No M6/M7.
No production activation.
No RELEASE_BOUND/gate pass.
No merge.

Return PR #44 for principal rereview.
