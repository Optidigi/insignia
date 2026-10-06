# M5-015R — fresh live Availability Hold v2 qualification

## Goal

Repeat the intended M5-015 live adapter qualification under fresh authority after the stopped transport-gate incident.

Expected lifecycle:

DRAFT → ACTIVE → v2 acquire to DRAFT → fresh-process observe → v2 restore ACTIVE → ARCHIVED cleanup.

No production activation coordinator or RELEASE_BOUND execution.

## Entry

Begin only after verified normal merge of PR #45 at:
- base `245be82fd3dd3a0dbe808cb65340ce16e1caa503`
- head `ee86996a55b6c7f4cccfbb4b326522b6f9d0cb4c`
- tree `c68d782d6c0f985ad724c277435cf792e0a40bbe`

Verify actual merge parents/tree and remote main.

Use actual GPT-6.1-sol/high and repository-pinned skills.

## Historical M5-015

Never write `/home/serveradmin/insignia-m5-015-handoff/run`.

M5-015 remains STOPPED and NOT_RUN for the live lifecycle.

## Fresh run

Use:
`/home/serveradmin/insignia-m5-015r-handoff/run`

Fresh marker:
`insignia-m5-015r-...`

No historical product may be accepted as this run's fixture.

## Mandatory process-level network escape guard

Before adapter construction or live logic:

1. capture native fetch privately;
2. replace/guard `globalThis.fetch` with a fail-closed function throwing `network_escape_denied`;
3. create the experiment operator with the captured native fetch as its only underlying external transport;
4. create the production v2 adapter only with `fetchImpl: op.fetch`.

Keep the guard active for the entire start/resume process.

If `fetchImpl` is omitted or misspelled, the adapter must fail locally and produce zero external requests.

If this cannot be implemented exactly, STOP for principal review.

## Pre-request proof

Before any protected credential or Shopify request, prove with local/loopback tests:

- missing `fetchImpl` => `network_escape_denied`, zero outbound external calls;
- misspelled transport option => local denial;
- correct adapter injection reaches only operator transport;
- auth/create/direct status/read paths reach only operator transport;
- fresh child process installs the same guard before credentials;
- importing harness/test modules has no Shopify network side effects;
- no alternate direct external client exists in live M5-015R code.

Then complete:
- focused M5-015R tests;
- v1/v2 adapter tests;
- recovery tests;
- full root checks;
- stress 100/100;
- renderer control;
- PostgreSQL18 applicable CI;
- two fresh full-source GPT-6.1-sol/high reviews;
- all applicable exact-source CI green;
- clean source/tree/build/review/CI freeze.

Only after this gate may the new canonical live directory be initialized.

Any tracked source/build change afterward closes authority.

## Exact identity

Require:
- App `gid://shopify/App/429028933633`
- Client `1443cf6d03d39edae7c101a943c5c684`
- Store `insignia-rewrite-dev.myshopify.com`
- Shop `gid://shopify/Shop/105501393179`
- Installation `gid://shopify/AppInstallation/1054356963611`
- partnerDevelopment true
- grants contain `read_products`, `write_products`, `read_publications`

No scope/version change.

## Fresh budgets

These are M5-015R budgets, separate from the closed incident:

- auth exchanges: 2
- Admin GraphQL attempts: 96
- productCreate: 1
- direct setup/cleanup status updates: 3
- production adapter status mutations: 2
- publication/delete/inventory/variant/price/media/config/version/billing/cart/order/refund mutations: 0

Every outbound attempt must be durably reserved before dispatch.
No parallel provider calls.
No blind retries.

Every actual Shopify request must have a durable operator event. Any transport/accounting mismatch stops immediately before further mutation.

## Fixture

Create one fresh DRAFT product with run-bound title/handle/tag.

No publication mutation, media, collection, inventory or extra variant work.

Ambiguous create:
- never recreate;
- at most one exact-marker recovery lookup;
- ambiguity stops further mutation.

## DRAFT observation

Use the production v2 adapter.

Require exact valid DRAFT, complete configured intent, no schedule, held-safe effective visibility.

Record only publication IDs and `autoPublish` / `supportsFuturePublishing` booleans.

Record:
- `FUTURE_CAPABILITY_OBSERVED` or
- `FUTURE_CAPABILITY_NOT_OBSERVED`.

Do not manipulate publication membership.

Actual schedule => lifecycle STOP; cleanup only if state/write settlement is exact.

## ACTIVE setup

One direct DRAFT→ACTIVE update.

Then exact ownership + production v2 snapshot.

Require:
- intent-qualified;
- no schedule;
- configured intent equal to DRAFT intent.

For core PASS, require at least one effective published publication ID.

If zero, classify PARTIAL `ACTIVE_EFFECTIVE_VISIBILITY_NOT_OBSERVED`, do not acquire, and clean up safely.

## Durable intent + acquire

Persist/fsync exact `m5-availability-hold-v2` intent before the mutation.

Call production `acquire` once.

PASS requires:
- HELD;
- one DRAFT mutation;
- valid acquisition ACK;
- DRAFT held/current;
- unchanged configured intent;
- no effective publication IDs;
- no online-store effective visibility;
- no schedule.

Record ACK/readback `updatedAt` values and delta exactly. Timestamp difference alone is allowed.

No acquire retry.

## Fresh-process observe

Persist exact returned hold bytes + SHA256.

Terminate the start process.

Fresh resume process:
- installs network escape guard first;
- verifies hold path/permissions/hash/bytes before credentials;
- performs second allowed auth;
- calls production `observe` exactly once.

Require HELD under v2 semantic equality.

No mutation.

## Restore

Call production `restore` once.

PASS requires:
- RESTORED;
- one ACTIVE mutation;
- configured intent equal to original ACTIVE;
- effective published publication IDs equal original ACTIVE;
- online-store effective booleans equal original ACTIVE;
- no schedule.

Record timestamp diagnostics.

No restore retry or inferred ownership.

## Cleanup

Only with exact ownership/current state and all writes settled:

archive the exact fresh fixture once if needed.

Final production v2 snapshot:
- ARCHIVED;
- no effective publication IDs;
- no online-store effective visibility;
- no schedule.

Do not delete and do not mutate publication membership.

Ambiguous cleanup: one bounded classification read only; never resend.

## Result

`PASS_V2_LIVE` requires full lifecycle, complete request accounting, final archive and no unresolved write.

`PARTIAL` means safe known state but required effective-membership lifecycle wasn't fully exercised.

`STOPPED` means any transport/accounting, ownership, schedule, provider, intent, settlement, persistence, restore or cleanup ambiguity.

Never promote PARTIAL/STOPPED.

## Evidence

Return:
- PR45 merge receipt;
- gate/source/build/review/CI binding;
- network-escape red/green proof;
- complete outbound request ledger;
- fixture ownership;
- DRAFT/ACTIVE snapshots;
- hold intent bytes/hash;
- acquire ACK/result;
- fresh-process evidence;
- observe;
- restore receipt;
- cleanup;
- counts;
- capability flag;
- timestamp diagnostics;
- fresh completed reviews and final CI.

No bearer/secret/auth body, publication names or unrelated merchant data.

Stop for principal review. No successor merge, production activation, M6/M7 or launch.
