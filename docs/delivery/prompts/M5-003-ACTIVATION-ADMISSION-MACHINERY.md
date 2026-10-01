# M5-003 — activation/admission machinery and release-bound trust plumbing

## Status

Authorized only after normal merge of PR #28 at the exact principal-approved
head.

This slice is **local/off-store only**.

No Shopify/provider call, preview, deployment, product mutation, scope change,
or owner credential read is authorized.

Use actual GPT-6.1-sol high throughout:
- orchestrator/integrator;
- every writer/subagent;
- Spec/correctness reviewer;
- Standards/security reviewer.

M5 remains in progress after this slice unless separately adjudicated.

## Goal

Implement the production-owned activation contract needed to safely move a
ProductConfig from `REMOTE_READY_ACTIVATION_PENDING` to `ACTIVE`, without
performing a real Shopify activation.

Target shape:

```text
immutable revision
+ exact remote publication projection/readback
+ current install/key/epoch
+ RELEASE_BOUND Function artifact evidence
+ availability hold / admission evidence where required
        ↓
activation coordinator
        ↓
durable activation evidence
        ↓
M3/M4 effective revision activation
        ↓
safe availability restore
```

Everything fails closed when any evidence is absent, stale, mismatched or
conflicted.

## 1. Availability-hold abstraction

Define an application port for a product-wide commerce availability hold.

The current Shopify candidate is product status `DRAFT`, because Shopify
documents DRAFT as unavailable to customers across sales channels/apps and it
uses the existing `write_products` capability.

Do not assume this alone proves all in-flight checkout behavior.

The application abstraction must not hard-code Shopify enum strings into domain
logic.

Suggested contract:

```ts
ProductAvailabilityHoldPort {
  snapshot(scope, productId): Promise<ProductAvailabilitySnapshot>
  acquire(scope, productId, expectedSnapshot): Promise<AvailabilityHold>
  observe(scope, hold): Promise<AvailabilityHoldObservation>
  restore(scope, hold, expectedCurrent): Promise<RestoreResult>
}
```

The hold snapshot must retain enough provider state to avoid blindly restoring
over merchant changes.

At minimum normalize:
- product ID;
- product status;
- provider updated-at/version evidence if available;
- observed publication/visibility metadata needed to detect drift;
- observation timestamp.

Do not mutate publication membership in this slice.

## 2. Shopify hold adapter — implementation only

Add a Shopify adapter for the candidate hold using `productUpdate(status:DRAFT)`
and exact readback.

No live call.

Requirements:
- exact tenant/product binding;
- current credential/install fencing;
- explicit before snapshot;
- mutation response/user-error normalization;
- exact post-write readback;
- no automatic retry of an ambiguous mutation without readback;
- restoration only when current remote state still matches the owned hold state;
- if merchant/provider state changed while held, return conflict/operator-hold
  instead of overwriting it.

Restoration returns the original product status.

Do not change title, media, variants, publications, inventory or price.

Do not claim DRAFT alone drains already-started carts/checkouts.

## 3. Admission requirement classifier

Preserve the M4/M5 rule:

An all-channel admission hold is required for:
- first Insignia publication;
- required/optional policy-mode transition.

A normal revision update that does not change the product's enforcement mode
does not automatically require the availability hold, unless another readiness
rule requires it.

Build a pure classifier from:
- prior effective revision/mode;
- proposed immutable revision/mode;
- installation generation;
- publication operation state.

No browser input decides this.

## 4. Activation evidence record

Create a versioned durable activation-evidence record.

It should bind at minimum:
- shop ID;
- config ID;
- operation ID;
- revision ID/hash;
- installation generation;
- authorization generation/epoch;
- selected public key ID;
- exact desired/observed publication projection digests;
- RELEASE_BOUND artifact evidence digest/reference;
- Function object observation digest/reference;
- availability-hold evidence when required;
- admission class;
- created/observed timestamps;
- activation decision version.

Evidence rows are immutable.

Do not persist credentials or private key material.

## 5. RELEASE_BOUND trusted evidence plumbing

Do not weaken the current artifact model.

Production readiness continues to require `RELEASE_BOUND`.

Implement a server-only trusted release-evidence port suitable for a later
deployment pipeline.

The port must not accept:
- buyer/browser values;
- generic unsigned environment JSON as sufficient authority;
- SOURCE_ONLY;
- DEV_PREVIEW_OBSERVED.

The expected future release record should bind:
- exact source commit;
- app version resource/reference;
- Transform/Validation handles;
- input-query SHA-256;
- Wasm SHA-256;
- app client ID;
- released/active-version identity supplied by a trusted deployment/operator
  source.

Do not generate RELEASE_BOUND evidence in this slice.

Shopify currently supports `shopify app deploy --no-release`, which creates an
unreleased app version. An unreleased version is **not** production
RELEASE_BOUND evidence.

## 6. Activation coordinator

Create the production application use case, for example:

```ts
activatePublishedRevision(...)
```

Order of checks:

1. current active tenant/install;
2. exact operation is current and activation-pending;
3. immutable revision/hash still match;
4. exact desired/observed projection remains equal and fresh;
5. key/epoch/public config still current;
6. Function ownership/query observation still current;
7. trusted RELEASE_BOUND evidence matches expected build and observation;
8. determine whether availability hold is required;
9. if required, require owned hold evidence and exact observed held state;
10. persist immutable activation evidence;
11. activate the exact operation/effective revision in the existing durable
    M3/M4 transaction;
12. restore product availability only after activation commit;
13. restoration conflict moves to explicit operator/recovery state; it never
    rolls activation back by rewriting historical evidence.

Do not call lower-level M3 activation from browser/controllers directly.

## 7. Crash/recovery semantics

Test all boundaries:

- crash before hold;
- mutation response lost after hold acquisition;
- crash after hold but before publication/activation;
- crash after activation evidence persisted but before activation commit;
- crash after activation commit before restore;
- restore response lost;
- merchant changes product status while held;
- reinstall/key epoch changes while held;
- remote projection drifts while held.

Queue/recovery can retry observation and safe next action, not blindly replay
provider mutation.

## 8. Repair/admin state

Extend merchant publication state/read model to distinguish:
- activation waiting for release evidence;
- activation waiting for hold;
- held/pending activation;
- activated/restoration pending;
- restoration conflict/operator hold.

Do not label any of these ACTIVE unless the durable effective revision is
actually active.

No new buyer/storefront UI.

## 9. Large-history query-plan proof

Close the existing local performance unknown.

Use PostgreSQL 18 with a realistically large retained history for one config
(e.g. >=100,000 revision/publication history rows).

Capture `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for:
- current M5 publication pointer read;
- fallback latest-current-generation operation lookup;
- active/effective revision read used by Admin.

Acceptance:
- current-pointer path is index/PK bounded;
- fallback uses the intended current-generation index and does not sort/scan the
  full retained history;
- record actual planning/execution rows/times as evidence;
- no user-facing SLA is inferred from one machine.

If the query plan is poor, add the narrow index/query correction in this PR.

## 10. No remote provider work

Explicitly forbidden:
- Shopify CLI app dev/deploy/release/execute;
- Admin/Partner/App Events calls;
- credential-file reads;
- product status mutation;
- publication mutation;
- scope/reinstall work;
- cart/checkout/order operations.

Provider adapters are tested with synthetic HTTP fixtures only.

## 11. Tests

### Hold adapter
- acquire success/readback;
- ambiguous mutation then successful observation;
- already-DRAFT prestate;
- restore original ACTIVE/ARCHIVED/DRAFT state as applicable;
- restore conflict if product changed;
- inactive/reinstalled tenant;
- wrong product/shop;
- malformed provider response;
- timeout/429/5xx classifications.

### Activation
- same-mode revision no-hold path;
- first publication requires hold;
- optional→required and required→optional require hold;
- missing RELEASE_BOUND blocks;
- DEV_PREVIEW_OBSERVED blocks;
- stale/mismatched build/Function/public-config blocks;
- exact positive synthetic activation;
- activation exactly once;
- crash/recovery cases above;
- restoration conflict leaves explicit operator state.

### Database
Real PostgreSQL 18:
- immutable activation evidence;
- concurrent activation attempts;
- reinstall/epoch race;
- operation supersession;
- 100k history query plans.

### Regression
Run all existing M1–M5-002 suites including:
- 100-case M5 geometry stress;
- Rust/Function replays;
- boundaries/secrets/history.

## 12. Work split

Use actual GPT-6.1-sol high.

At most two non-overlapping writers.

### Writer A — activation/application/database
Own:
- admission classifier;
- activation coordinator;
- activation evidence schema/repository;
- crash/race tests.

### Writer B — Shopify availability hold
Own:
- product availability read/update adapter;
- typed provider errors;
- synthetic HTTP fixtures/tests.

### Integrator
Own:
- trusted RELEASE_BOUND port/composition;
- admin state projection;
- root exports/lock/CI;
- query-plan benchmark;
- cross-workstream tests;
- reviewer fixes.

No writer performs provider calls.

## 13. Fresh reviews

Fresh independent read-only GPT-6.1-sol high:
- Spec/correctness;
- Standards/security.

Review full integrated source.

## 14. Acceptance

M5-003 is principal-reviewable when:

1. first/mode-change activation cannot proceed without owned hold evidence;
2. same-mode activation does not take an unnecessary hold;
3. production activation cannot proceed without RELEASE_BOUND evidence;
4. dev-preview/source evidence cannot satisfy production activation;
5. exact activation is transactionally idempotent;
6. crash/recovery never blindly restores or overwrites merchant state;
7. post-activation restoration conflicts are explicit/recoverable;
8. 100k-history query plans are bounded by intended indexes;
9. all existing CI is green, including 100-case geometry stress;
10. fresh GPT-6.1-sol high reviewers report no unresolved material issue.

## 15. Explicitly out of scope

No live:
- app version creation/release;
- Product status hold;
- policy activation;
- Function deployment;
- Shopify mutation/read;
- storefront/cart/checkout;
- M6/M7.

No M5 milestone completion or G6/G7 gate pass is claimed by this slice alone.

## 16. Handoff

Return one integrated PR with:
- exact refs;
- activation state machine;
- hold contract/provider fixtures;
- RELEASE_BOUND trusted-port contract;
- immutable activation evidence example;
- crash/race matrix;
- 100k PostgreSQL query-plan artifact;
- full final-head CI;
- GPT-6.1-sol high review dispositions.

Stop for principal review.

No merge, live activation, deployment, M6/M7, gate pass or launch is authorized.
