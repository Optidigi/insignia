# PR #44 — external principal review

**Verdict: CHANGES_REQUESTED at the exact reviewed head.**

Exact binding:
- base / effective merge base `55060c5a48617a27858d10fb0db639c7e9efe148`
- reviewed head `f016e39cf6b54cd2b7e7860a5681c4bb867a6e51`
- reviewed tree `fb687b6ca8bff15a62b6fbd449cd293ee47c8e23`
- final-head workflows 10/10 SUCCESS, all attempt 1
- native GitHub reviews none

Accepted shape:
- explicit v1/v2 hold/snapshot/evidence versioning;
- historical v1 behavior preserved;
- new activation creates v2;
- updatedAt is audit metadata, not v2 semantic equality;
- configured intent is separate from effective visibility;
- configured intent uses Publication.includedProducts, not publication_ids/V2 emptiness;
- bounded pagination/deadlines and no-retry behavior;
- mixed-version persistence/recovery fences;
- semantic restoration rather than timestamp equality.

Material blocker:
`availabilityV2IntentQualified()` currently requires both no actual scheduled entries and every included Publication to have `supportsFuturePublishing=false`.

`supportsFuturePublishing` is a capability of the Publication/channel, not evidence that this exact product is scheduled. Shopify's own product-publishing example shows Online Store with `supportsFuturePublishing=true`.

So a normal Online Store product with no schedule can be rejected before any hold write solely because its channel supports scheduling. That broadens “scheduled publishing remains unqualified” into “any product included in a future-capable publication is unsupported,” which can exclude the core storefront use case.

The test `explicit future-capable intent stays in evidence and fails closed before acquire` locks in the defect.

Required correction:
- keep `supportsFuturePublishing` in configured intent and its digest;
- do not use capability=true alone as product scheduled intent;
- qualification should fail on actual observed scheduled/staged product records, not channel capability;
- actual non-empty scheduled evidence remains fail-closed;
- no timestamp tolerance;
- no live Shopify rerun.

Do not merge this head. Correct the same PR locally and return for principal rereview.
