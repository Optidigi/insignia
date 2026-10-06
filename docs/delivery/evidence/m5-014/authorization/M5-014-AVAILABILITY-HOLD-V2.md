# M5-014 — Availability Hold v2

## Goal

Implement a new versioned production availability-hold contract reflecting M5-010 through M5-013 evidence, without any live Shopify operation.

Core facts:
- Product.updatedAt is audit/observation metadata, not native CAS.
- ACTIVE→DRAFT can legitimately remove effective publication membership.
- configured publication intent is distinct from current/effective visibility.
- historical `m5-availability-hold-v1` evidence must never be reinterpreted.

## Baseline

Begin only after verified normal merge of PR #43 at:
- base `9d896e824ebf3beb5e560ce89e9873799869f6c5`
- head `4ab249b764a58a08fb6599a2200d5214458da252`
- tree `3bff5ab4b8a9beee4d772e9a2e00869783cea3f5`

Use actual GPT-6.1-sol/high and repository-pinned TDD/tests-mocking, diagnosing-bugs, code-review, writing-for-agents and handoff skills.

## 1. Preserve v1

Keep `m5-availability-hold-v1` parsing, observation and trusted recovery behavior unchanged.

Never:
- reinterpret v1 providerVersion/visibilityDigest;
- rewrite historical v1 JSONB;
- derive v2 intent from current provider state and call it historical v1 evidence.

New activation operations must create v2 holds only.

An unresolved persisted v1 hold must not be automatically adopted by the v2 coordinator. Preserve/operator-hold it and use the existing trusted v1 recovery route where applicable.

## 2. V2 contracts

Add an explicit v2 snapshot and hold:
- `m5-product-availability-snapshot-v2`
- `m5-availability-hold-v2`

V2 snapshot stores structurally:
- exact scope and product ID;
- normalized product availability state;
- provider updatedAt as diagnostic metadata;
- configured publication-intent projection;
- effective-visibility projection;
- observedAt/receivedAt;
- canonical digests for intent/effective projections.

Configured intent includes at minimum sorted unique included publication IDs plus any supported scheduled/staged metadata.

Effective visibility includes at minimum sorted currently-published publication IDs and explicit effective online-store state. Publish dates/timestamps are retained evidence but not identity by themselves.

## 3. Generic configured intent

Do not hard-code Copilot/publication IDs in production.

Use `read_publications` to enumerate all shop Publications in complete bounded pages. For each publication, determine whether the exact product is included using `Publication.includedProducts` with exact product-ID filtering.

Requirements:
- static GraphQL documents;
- complete pagination;
- unique publication IDs;
- nested includedProducts complete and zero-or-one exact product;
- operation-wide deadline across every page;
- bounded bodies;
- serial calls, no retry;
- explicit engineering page/item guard, documented as safety guard rather than merchant capacity.

Legacy/resourcePublications and resourcePublicationsV2 may supply supplemental scheduled/staged metadata, but:
- V2 emptiness is never absence of configured intent;
- publication_ids is never configured-intent authority;
- effective/staged publication IDs absent from the configured included set fail closed.

## 4. Effective visibility

Normalize current effective publication separately.

DRAFT is held-safe only when:
- status DRAFT;
- no currently-effective published publication remains;
- no effective online-store visibility remains;
- configured intent remains complete and unchanged.

Any truncation/inconsistency fails closed.

## 5. updatedAt

Record provider updatedAt everywhere.

V2 must **not** require ACK/readback updatedAt equality and must **not** add a time tolerance.

Settlement depends on relevant semantic equality:
- target status;
- configured intent;
- effective visibility.

A changed updatedAt with equal relevant semantics is diagnostic, not automatically CONFLICT.
A semantic change is CONFLICT even with identical updatedAt.

No native CAS is claimed.

## 6. Acquire

For non-DRAFT prestate:
1. exact complete v2 before read;
2. require persisted before semantic equality;
3. one status-only DRAFT mutation;
4. ACK must identify exact product/DRAFT;
5. complete v2 readback;
6. configured intent equals before;
7. readback is held-safe;
8. ACK effective fields do not contradict readback;
9. updatedAt difference alone does not fail.

Persist exact v2 held snapshot and return HELD.

Original DRAFT requires no mutation.

Lost/ambiguous mutation response remains unattributable: observe only, no replay.

Retain current ARCHIVED transition policy in this slice; do not introduce an unrelated optimization.

## 7. Observe

V2 HELD requires exact scope/product, DRAFT, unchanged configured intent and held-safe effective visibility.

Provider updatedAt may advance while those semantics remain equal.

Any status/intent/effective drift returns CONFLICT.

V1 observe stays unchanged.

## 8. Restore

Before mutation, prove the exact v2 held semantics and unchanged configured intent.

One status-only mutation returns to original status.

Complete v2 post-read RESTORED requires:
- original status;
- original configured intent;
- original effective publication membership semantics;
- original scheduled/future intent;
- no contradictory effective visibility.

Do not require historical updatedAt or publish timestamps to equal. Effective membership IDs/booleans are semantic; timestamps are evidence.

Ambiguous restore remains RESTORATION_PENDING and is never inferred as owned merely from later matching state.

## 9. Scheduled publishing

Scheduled/future publishing has not been live-qualified.

Represent it explicitly. If unchanged/safe restoration cannot be proven, fail closed before activation relies on the hold.

Never discard schedule dates or claim scheduled-publication support from synthetic tests.

## 10. Activation evidence/versioning

Make activation equality version-aware.

New hold intents use v2 only.

Do not silently change `m5-activation-evidence-v1`; issue a new explicitly versioned activation-evidence schema for new v2 operations while retaining historical v1 parsing/evidence.

SAME_MODE remains no-hold.

RELEASE_BOUND requirements stay unchanged.

## 11. Recovery

Make recovery version-aware.

v1: exact historical behavior unchanged.

v2:
- trusted decision binds the exact observed v2 record;
- original-state closure compares v2 semantic status/intent/effective state, not provider updatedAt equality;
- outstanding-write settlement by trusted operator remains mandatory.

No historical DB rewrite.

## 12. Transport

The multi-query v2 snapshot uses one high-level deadline across pagination.

Once expired, no later page/request may dispatch.

Keep current credential/install fencing, bounded bodies, strict error/shape handling, no redirects and no retries.

## 13. Required tests

TDD. Include at minimum:

- all v1 adapter/recovery behavior stays green;
- new activation creates v2 only;
- unresolved v1 hold never auto-upgrades;
- multi-page publication intent enumeration;
- auto-publish intent survives DRAFT while effective membership disappears;
- V2/association emptiness cannot erase includedProducts intent;
- duplicate/truncated/inconsistent projections fail;
- scheduled metadata retained/fails closed when unsafe;
- M5-011 reproduction: ACK updatedAt T, readback T+1, equal semantics => HELD;
- same timestamp + intent drift => CONFLICT;
- effective contradiction => CONFLICT;
- unrelated updatedAt advance while held => HELD;
- restoration with same effective publication IDs but new publish timestamps => RESTORED;
- missing/extra effective publication ID => CONFLICT;
- ambiguous acquire/restore => no retry;
- operation-wide deadline blocks later pages;
- version-aware activation evidence/recovery;
- v1/v2 JSON persistence compatibility.

Run full applicable regression, PostgreSQL18 workflows, 100-case publication stress and renderer negative control.

## 14. No live work

Forbidden:
- Shopify Admin/Partner calls;
- credentials;
- browser/Admin UI;
- app version/scope changes;
- product/publication mutation;
- new fixture;
- CLI app dev/deploy;
- production activation;
- M6/M7.

## 15. Handback

Return one integrated implementation PR with source, tests, compatibility statement, research/limitations, fresh GPT-6.1-sol/high Spec/security reviews and final CI.

Stop for principal review.

No merge, live qualification, M5/G6/G7 completion or launch.
