# M5-017 — Availability Hold v3 effective-anchor contract + one live qualification

## Goal

Replace the unusable complete-configured-intent premise for **new** activation with a versioned v3 hold that protects observable effective availability and the exact Publications known to be effective before the hold.

Then, after complete local qualification and a frozen precredential gate, execute one fresh live v3 lifecycle on the designated development store in the same PR.

No production activation coordinator is run live.

## Entry

Begin only after verified NORMAL merge of PR #47 at:
- base `d0efd626222047a2047573f678b019cd7b1802a9`
- head `857e0db43918dada608af8aa63654756673c6ba7`
- tree `dcd5aca2e0f4152b9eb07b7b1616f0d309ecf4a7`

Verify actual ordered merge parents/tree and remote main.

Use actual GPT-6.1-sol/high and repository-pinned writing-for-agents, TDD/tests-mocking, diagnosing-bugs, code-review and handoff skills.

Read M5-014 through M5-016 and the current operating model.

## 1. Preserve v1 and v2

Historical v1 and v2 schemas/JSONB/evidence/recovery meanings are immutable.

Do not:
- reinterpret v1 providerVersion/visibilityDigest;
- reinterpret v2 configuredIntent;
- migrate v1/v2 holds to v3 from current provider state;
- make unresolved v1/v2 holds automatically resume under v3.

New activation operations after M5-017 use v3 only.

Persisted unresolved v1/v2 operations remain operator-held and use their existing trusted recovery routes.

## 2. V3 snapshot

Add:
`m5-product-availability-snapshot-v3`

It stores:
- exact AvailabilityScope;
- productId;
- normalized status/state;
- provider updatedAt as diagnostic metadata;
- effective visibility:
  - sorted currently-published Publication IDs;
  - online-store publishedAt/url presence booleans;
  - exact observed publication evidence including publishDate/isPublished;
- visible scheduled/staged records from the complete product publication projection;
- **effective anchors** for every currently effective Publication ID:
  - publicationId;
  - exact direct-resolution success;
  - productIncluded=true;
  - autoPublish;
  - supportsFuturePublishing;
- observedAt/receivedAt;
- canonical effective/anchor digests.

V3 does **not** contain or claim a complete configured-intent set.

Any visible scheduled/staged record makes the snapshot unqualified for automatic holding.

## 3. Effective Publication anchor resolution

For every currently-effective Publication ID returned by the product projection, direct-resolve it generically by ID and verify exact product inclusion.

Do not enumerate shop Publications/Catalogs for v3 authority.

Prefer a bounded `nodes(ids:)`/fragment mechanism if supported by the pinned schema; otherwise use fixed bounded serial exact-ID queries.

Requirements:
- static documents;
- exact returned Publication ID;
- exact product ID in complete `includedProducts(first:2, query:id...)`;
- zero-or-one exact product;
- autoPublish/supportsFuturePublishing retained;
- complete pageInfo;
- no names/titles/account metadata;
- duplicate/missing/null/permission/shape mismatch fails closed.

Engineering guard:
- at most 64 effective Publication anchors per product;
- bounded batches/serial requests under one high-level deadline;
- this is a safety guard, not claimed merchant capacity.

## 4. Effective semantics

V3 semantic equality uses:
- scope/product;
- state;
- currently-published Publication ID set;
- online-store publishedAt/url presence booleans;
- visible scheduled/staged records;
- effective-anchor Publication IDs and exact productIncluded/capability fields.

Diagnostic timestamps/URLs/publish dates are retained but are not equality by themselves where their corresponding semantic presence/membership is unchanged.

`updatedAt` remains diagnostic, never CAS and never ±tolerance.

## 5. Hold safety

A V3 held snapshot is safe only when:
- state = unavailable/DRAFT;
- no currently-published Publication IDs;
- no effective online-store presence;
- no visible scheduled/staged record;
- every Publication that was effective in `before` still direct-resolves and still includes the product.

This anchor check preserves the known pre-hold channel intent even when shop-wide discovery omits the channel.

V3 does not claim that no new hidden non-effective intent was added during the hold.

## 6. Acquire

For a non-DRAFT before state:

1. read complete v3 before;
2. require semantic equality with persisted before;
3. require no visible schedule;
4. reserve durable acquisition claim;
5. send one status-only DRAFT update;
6. ACK must identify exact product/DRAFT;
7. complete v3 held readback;
8. require held-safe conditions;
9. require all original effective anchors still included;
10. updatedAt difference alone does not conflict.

Return HELD with exact immutable v3 held snapshot + acquisition acknowledgement.

Original DRAFT requires no mutation if already held-safe.

Ambiguous/lost acquire response:
- never replay;
- no attribution from later matching status;
- operator hold/recovery.

## 7. Observe while held

Require:
- exact DRAFT;
- no effective visibility;
- no visible schedule;
- all original effective anchors still include the product.

If an original anchor disappears or capability metadata changes, CONFLICT.

Do not use shop-wide Publication discovery.

## 8. Restore

Before restore:
- exact held observation;
- all original effective anchors still included;
- no visible schedule;
- normal activation readiness/beforeSend fences remain.

Reserve one durable restore claim.

Send one status-only mutation back to original state.

Perform complete v3 readback.

### RESTORED

Requires:
- original status;
- exact original effective Publication-ID set;
- exact original online-store presence booleans;
- no visible scheduled/staged record;
- all original effective anchors still include the product.

Publish dates/provider updatedAt may differ.

### Restore semantic mismatch — compensating rehold

If restore mutation is ACKNOWLEDGED/settled and exact readback proves:
- exact owned product;
- status is the requested original active/visible state;
- effective semantics do not equal the original before;

then V3 may perform **one and only one compensating status-only DRAFT mutation**.

After compensation:
- exact readback must be DRAFT/held-safe with no effective visibility;
- return distinct `REHELD_CONFLICT` carrying restore ACK/readback, semantic mismatch and compensation ACK/readback.

No second compensation/retry.

The activation coordinator must convert `REHELD_CONFLICT` into durable OPERATOR_HOLD.

If restore response is ambiguous/unsettled, do not compensate automatically; return RESTORATION_PENDING/operator path because ownership of the active transition is unknown.

If compensation is ambiguous, return RESTORATION_PENDING/incident with exact audit; no retry.

## 9. Scheduled/future publication

Visible scheduled/staged product publication is still unsupported for automatic activation.

If present before acquire, while held, or after restore:
- fail closed;
- never claim v3 success.

The DIRECT_ONLY platform evidence means V3 cannot prove absence of **all hidden non-effective** future intent. Document that as a platform residual, not as a hidden guarantee.

## 10. Activation/evidence versioning

Add:
- `m5-availability-hold-v3`
- `m5-activation-evidence-v3`
- v3 recovery decision/resolution versions as required.

New FIRST_PUBLICATION/MODE_CHANGE uses v3 only.

SAME_MODE remains no-hold.

Unresolved v1/v2 state is never auto-upgraded.

Activation commit rules stay fail-closed.

After activation:
- RESTORED => normal ACTIVE completion;
- REHELD_CONFLICT => OPERATOR_HOLD with product DRAFT;
- RESTORATION_PENDING => existing pending/operator path.

## 11. Persistence

Add additive SQL constraints for v3:
- nested version/tenant/product identity;
- immutable acquisition/restoration/compensation receipts;
- held snapshot safety;
- v3 evidence/recovery exact version binding.

No historical data rewrite.

Down migration must fail closed if v3 records exist rather than reinterpret them as v2.

## 12. Recovery

Trusted v3 recovery remains observation-only unless a separately authorized product mutation is explicitly part of operator recovery.

V3 recovery equality compares effective/anchor semantics, not provider timestamp equality.

Outstanding writes must be `SETTLED_BY_TRUSTED_OPERATOR`.

Never convert v1/v2 resolution to v3.

## 13. TDD minimums

### Version compatibility
- v1 exact behavior unchanged;
- v2 exact behavior unchanged;
- new activation creates v3 only;
- unresolved v1/v2 => operator hold.

### PR47/DIRECT_ONLY reproduction
- shop-wide publications/catalogs may omit an effective Publication;
- v3 succeeds because the effective ID is direct-resolved and included;
- no shop-wide enumeration is used for v3 authority.

### Acquire
- ACTIVE with hidden effective Publication -> DRAFT HELD;
- ACK/readback updatedAt T/T+1 allowed;
- original anchor inclusion retained;
- removed anchor => CONFLICT;
- actual schedule => no write;
- ambiguous ACK => no retry.

### Observe
- DRAFT + zero effective + anchors included => HELD;
- effective visibility appears => CONFLICT;
- anchor inclusion/capability drift => CONFLICT.

### Restore
- original effective set restored with different publish/update timestamps => RESTORED;
- missing effective ID => mismatch then successful one-shot rehold => REHELD_CONFLICT;
- extra effective ID => rehold;
- online-store boolean mismatch => rehold;
- schedule appears => rehold/conflict;
- ambiguous restore ACK => no compensation/retry;
- ambiguous compensation => pending/operator incident.

### Durable replay
- acquisition/restore/compensation claims survive process restart;
- no mutation replay after crash/reentry;
- audit receipts immutable.

### Transport
- operation-wide deadline;
- bounded bodies;
- exact current identity/install/grants;
- no request after timeout/quarantine.

Run full regression, PostgreSQL18 CI, stress100/100 and renderer negative control.

## 14. Same-PR live qualification

Do not open provider authority until:
- v3 source/tests complete;
- production build frozen;
- two fresh full-source GPT-6.1-sol/high precredential reviews clear;
- all applicable exact-source CI passes;
- source/tree/build/review/CI gate frozen;
- process-level network escape guard proven locally.

Then create fresh canonical:
`/home/serveradmin/insignia-m5-017-handoff/run`

Use a fresh `insignia-m5-017-...` disposable DRAFT product.

Exact identity/grants remain the established development app/shop/install and contain:
`read_products`, `write_products`, `read_publications`.

No scope/version operation.

### Live budget
- auth exchanges <=2
- Admin GraphQL <=128
- productCreate <=1
- direct setup/cleanup status updates <=2
- v3 adapter status mutations <=3 (acquire, restore, and only if naturally needed, one compensation)
- all publication/delete/inventory/variant/price/media/config/billing/cart/order mutations 0
- no retry, serial only

### Lifecycle
1. create DRAFT fixture;
2. valid v3 DRAFT snapshot;
3. direct ACTIVE setup;
4. valid v3 ACTIVE snapshot;
5. require at least one effective Publication ID;
6. require every effective ID direct-resolves/included;
7. persist/fsync v3 hold intent;
8. acquire once to DRAFT;
9. persist exact returned hold;
10. terminate;
11. fresh process + exact hold verification;
12. observe once HELD;
13. restore once;
14. expected normal case RESTORED to exact original effective set;
15. archive disposable fixture once when exact settlement permits;
16. exact final ARCHIVED/effectively unpublished readback.

If restore naturally returns semantic mismatch, allow the production v3 one-shot compensation path. A successful REHELD_CONFLICT is STOPPED qualification, not PASS, but it should leave the product safely DRAFT before cleanup.

### PASS_V3_LIVE
Requires:
- hidden third-party effective Publication(s) can be anchored by exact ID;
- acquire HELD;
- fresh-process observe HELD;
- restore RESTORED;
- original effective membership exactly returns;
- final ARCHIVED cleanup;
- complete accounting/no unresolved writes.

No intentional mismatch is induced live.

## 15. Handback

One integrated successor PR may contain v3 implementation, migration/tests, frozen precredential reviews/CI, live run/evidence, completed-change fresh reviews and final-head CI.

After provider access begins, no production source/build changes are allowed. Only docs/evidence may be added; a production defect found live stops the run and returns for principal correction.

Stop for principal review.

No merge of successor, production activation, RELEASE_BOUND, G7, M6/M7 or launch.
