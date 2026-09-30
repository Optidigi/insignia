# M4-003 — signing key lifecycle and Option A publication readiness

## Status

Authorized only after the exact approved normal merge of PR #25.

Whole-quote v2 is now the adopted rewrite authorization protocol under the accompanying principal decision. **This slice does not deploy it to merchants.**

M4-003 productionizes the remaining M4-owned trust/state surfaces:

1. signing-key lifecycle and authorization epoch;
2. public Function key/config projection;
3. ProductConfig required/optional policy projection;
4. CAS/readback/reconciliation against Shopify Admin;
5. publication-readiness integration with the existing M3 journal.

M5 still owns the merchant-facing publication workflow and the final safe activation/admission conditions.

## Goal

Create one production implementation path in which the application can prove:

```text
active installation
+ accepted v2 protocol
+ encrypted eligible signing key(s)
+ exact desired public Function config
+ exact desired product registration/policy projection
+ M3 durable publication operation
+ Shopify CAS acknowledgement/readback
        ↓
well-defined READY / PENDING / CONFLICT state
```

Quote issuance must remain fail-closed unless its signing key and public Function projection are compatible.

Do not pretend Admin readback proves Function propagation or merchant publication activation.

## 1. v1.4 governance amendment

Update the current plan/ledger narrowly to v1.4.

Record:
- whole-quote v2 adopted for production implementation;
- exact carrier/wire version now frozen;
- no per-line runtime fallback;
- current 32/200/10,000 profile remains an engineering guard, not merchant capacity;
- stack remains unmeasured;
- full G1-G8 acceptance remains outstanding at their existing blocking points.

Preserve historical v1.1/v1.2/v1.3 expected hashes/checks. Do not overwrite or delete old verification.

Pre-amendment v1.3 hashes:
- plan `b730c0dc274af8180a9aae3290189a8fd61b6b92e06681d345fe5d9aab22c06d`
- ledger `d4297182b12978822dae124a040a0d47aafcdb7749f7ad8602f0626e964937e9`.

## 2. Durable signing-key model

Add dbmate-owned persistence for installation-scoped v2 signing keys.

At minimum bind:
- tenant shop;
- installation generation + authorization-generation UUID;
- numeric v2 key ID constrained to `0..65535` and nonzero unless a reviewed reason requires zero;
- Ed25519 public key bytes;
- stable public-key fingerprint;
- encrypted private-key envelope/reference;
- key state: active / retiring / revoked / destroyed as needed;
- first valid shop-local day;
- last valid shop-local day;
- created/retired/revoked timestamps;
- wrapping-key ID/version.

### Private key security

Private key material must never be stored plaintext.

Use a versioned authenticated-encryption envelope under an injected key ring, with fresh random nonce and AAD including at least:
- shop ID;
- installation generation;
- authorization-generation UUID;
- key ID;
- envelope version.

The application DB may store ciphertext/nonce/tag/key-ID metadata only.

No private seed/PKCS8 material in logs, quote rows, outbox, fixtures, CI artifacts or Git.

Raw PostgreSQL tests must prove known synthetic private bytes do not appear in stored rows.

A missing wrapping key or tampered ciphertext/AAD fails closed.

## 3. Key-ID / accepted-set cleanup

Align durable quote authorization metadata with the adopted v2 protocol:

- key ID must be a checked numeric u16 concept end-to-end rather than arbitrary nonempty text;
- persisted authorization-set metadata must be demonstrably consistent with its decoded envelope header/set UUID/quote UUID/generation/epoch/context/total/member count;
- preserve the signer-reported key validity window or explicitly store both signer-key window and quote-validity window; do not fabricate authority metadata;
- existing quote valid-through remains D+2 and cannot be extended by re-signing.

Use a new migration; do not edit the already-merged historical migration after PR #25.

## 4. Key rotation semantics

Provide production application operations for:
- create/import a new signing key under an active installation;
- mark a new key active for issuance;
- overlap retiring keys long enough for all already-issued D..D+2 offers;
- stop new issuance on a retiring key;
- revoke a key for emergency invalidation;
- destroy private material only after policy permits.

Routine rotation must not invalidate valid accepted quotes merely because a newer key exists.

Emergency revocation may invalidate historical offers and must be explicit/auditable.

## 5. Authorization epoch semantics

Authorization epoch is an installation-wide emergency fence.

Provide a durable operation that increments the current u32 epoch under the shop/install lock.

Requirements:
- monotonic only;
- fail on overflow;
- old accepted sets cannot replay through the current quote service after commit;
- desired Shopify public config changes to the new epoch;
- no automatic increment for ordinary key rotation or ProductConfig publication;
- operation is auditable and idempotent under a command key.

## 6. Public Function configuration projection

Create one production-owned versioned projection matching the adopted Function parser.

At minimum:

```json
{
  "generationHex": "...",
  "epoch": 0,
  "maxBuckets": 32,
  "maxPhysicalQuantity": 10000,
  "allowNoMarket": false,
  "keys": [
    {
      "id": 7,
      "publicHex": "...",
      "revoked": false,
      "firstDay": 123,
      "lastDay": 126
    }
  ]
}
```

Generate it only from trusted durable installation/key state.

Rules:
- deterministic canonical JSON;
- bounded key count;
- total Function-visible metafield value strictly under Shopify's 10,000-byte Function-return limit with deliberate headroom;
- no private key material;
- no caller-supplied arbitrary JSON;
- every key independently passes canonical Ed25519 public-key admission equivalent to the Rust verifier;
- current issuer-selected key must appear as admitted and cover D..D+2 before quote signing is allowed.

## 7. Product registration / policy projection

Create production-owned builders for the exact v2 product anchors consumed by the Functions:

- `insignia_registration_v2`;
- `insignia_policy_v2`.

Projection input comes from:
- active installation authorization-generation identity;
- monotonically increasing ProductConfig publication revision/sequence;
- locked required/optional mode.

Do not accept buyer or arbitrary caller strings as final metafield values.

Preserve the existing pending/ready semantics required by the Function projection model.

## 8. Shopify Admin metafield adapter

Implement the exact 2026-07 read/write/readback adapter in `packages/shopify`.

Use `metafieldsSet` with `compareDigest` for every write.

Current Shopify contract states that `metafieldsSet`:
- accepts up to 25 metafields;
- is atomic for the submitted mutation;
- supports compare-and-set using `compareDigest`.

Do not omit compareDigest for a production write.

Adapter requirements:
- fixed mutation/query documents;
- bounded payload/body/timeout;
- tenant/install credential fencing;
- exact owner ID/namespace/key/type/value/digest readback;
- classified 401/403/429/network/GraphQL/user-error/CAS-conflict/provider-shape outcomes;
- ambiguous timeout followed by exact readback before any retry;
- no secrets/provider bodies in error logs.

Atomic Admin mutation acknowledgement is not Function-propagation proof.

## 9. App-owned namespace/access

Use the app-owned namespace/definitions expected by the current Function queries.

Before any live write, verify the designated app can read/write those app-owned Shop/Product metafields with existing scopes/ownership.

Do not broaden merchant write access to these enforcement fields.

If exact app ownership or required access cannot be proved without a new scope/definition permission, stop for principal direction rather than silently using merchant-writable fields.

## 10. Publication readiness builder

Move the M3 internal publication seam behind one reviewed application service.

A publication intent's expected projection must be derived by trusted code from:
- exact immutable ProductConfig revision;
- required/optional mode;
- current installation identity;
- current public Function config/key/epoch projection.

Callers may request a revision/mode; they may not supply the expected projection body/digest directly.

The service must journal before the first Shopify mutation.

## 11. Publication transition / recovery

Productionize the safe parts of the M0-008 contract:

- durable prepared intent;
- pending registration write;
- policy write;
- ready registration write;
- exact Admin readback after each ambiguous/acknowledged stage;
- same-operation replay after crash;
- CAS conflict/operator hold;
- stale installation generation rejection;
- no deletion of surviving enforcement anchor to repair conflicts.

Use the M3 PostgreSQL journal/state machine rather than the old MemoryJournal.

### Important

`ready-written` / exact Admin readback is **not application activation**.

Do not call `publication.activate()` merely because Admin readback matches.

## 12. Activation/readiness boundary

Expose a clear result such as:

```text
REMOTE_READY_ACTIVATION_PENDING
ACTIVE
CONFLICT
OPERATOR_HOLD
```

M4-003 must define the trusted evidence required to move from exact remote readback to application activation, but it does not need to pretend Shopify offers a global propagation barrier.

For first publication and required↔optional policy transitions, preserve the approved requirement for a separately proven all-channel/in-flight admission boundary.

If no safe production activation adapter is yet available, leave the operation activation-pending. This is an acceptable M4-003 result.

M5 may later supply the merchant-facing admission/availability workflow, but it must consume this explicit state rather than bypass it.

## 13. Quote issuance readiness

Add a server-side readiness port checked immediately before M4-002 signing.

At minimum require:
- current active installation generation/authorization UUID/epoch;
- selected signing key active/not revoked and D..D+2 eligible;
- desired public Function config contains the same generation/epoch/key;
- observed Shopify public config is exact/fresh enough under the defined policy;
- required Function pair readiness is not known-missing/drifted;
- ProductConfig revision remains effective/activated.

Until these are satisfied, production quote issuance fails closed.

The test-only synthetic composition may explicitly inject a fake READY result.

## 14. Function-object reconciliation

Add read-only Shopify adapter/port for the owned Cart Transform and Checkout Validation Function presence/configuration needed by quote readiness.

Do not deploy/update Functions in this slice unless separately returned as a principal proposal.

Readiness must distinguish:
- expected target present;
- missing;
- duplicated/conflicting owned target;
- observed version/hash/config drift where Shopify exposes enough identity;
- unknown/unverifiable.

Unknown is not READY.

## 15. Bounded live development-store proof

After local tests and fresh review, one serialized operator may use only the designated Public/Draft app/store.

This package may test **Admin CAS/readback and app-owned enforcement metafield access only**.

Use the existing archived M0-014 optional fixture product if still present and unchanged:
- product `gid://shopify/Product/10485042479387`.

Resource ceiling:
- no new products/variants/locations/orders;
- no product publication or storefront availability change;
- no cart/checkout/payment;
- no Function deployment/activation;
- no App Pricing change/event;
- no Market/discount/inventory mutation.

Allowed existing-credential files under explicit owner launch:
- `/home/serveradmin/.local/share/insignia-public-app/server.env`.

Never print/commit/modify credentials.

Read ceiling: 12 Admin GraphQL reads.
Mutation ceiling: 6 `metafieldsSet` calls.
Admin auth exchanges: at most 3.

Live test sequence:
1. verify exact current app/shop/product and no active commerce use;
2. read prestate values + compareDigest for package-owned Shop/Product test targets;
3. perform one exact CAS set covering package-owned enforcement/probe state;
4. read exact value/owner/namespace/key/type/digest back;
5. demonstrate stale compareDigest CAS rejection without changing state;
6. restore the exact prestate with CAS and re-read it;
7. if prestate was absence, delete only package-created probe fields through a separately safe cleanup path if deletion semantics are verified; otherwise prefer a package-specific probe namespace/key that can remain harmlessly absent/restored.

Do not leave actual `insignia_public_config_v2` / registration/policy values pointing at a synthetic key after the proof. If safe exact restoration cannot be guaranteed, use non-Function probe keys and report that exact production-key write remains unproved.

No second live loop merely to make the result look green.

## 16. Tests

### Crypto/key lifecycle
- encrypted private key plaintext absent from raw DB;
- public/private pair consistency;
- weak/noncanonical public key rejection;
- missing/tampered wrapping key;
- active→retiring overlap;
- revoked key stops new quote issuance;
- emergency epoch increment invalidates old current-authority replay;
- reinstall fences old keys.

### Projection
- exact canonical public-config JSON;
- value-size headroom;
- TS/Rust parser compatibility;
- active selected key included;
- revoked/out-of-window omitted or marked according to the frozen Function contract;
- wrong generation/epoch fails readiness.

### Publication
- journal-before-write;
- CAS success/readback;
- write-then-timeout then exact readback;
- crash/restart at every durable stage;
- stale CAS conflict;
- wrong owner/namespace/type/readback;
- current-generation rollover;
- first-publish and required↔optional transition remains activation-pending without admission proof;
- routine same-mode revision follows the reviewed readiness rules;
- no direct caller-supplied expected projection.

### Quote readiness
- issuer key absent from public projection rejects;
- exact key/config projection ready permits synthetic quote;
- remote drift rejects;
- missing/duplicate Function ownership rejects;
- epoch increment rejects prior current authority.

### Regression
- M4-002 production vectors unchanged;
- final adopted v2 Functions remain byte-compatible;
- prior M1-M4 suites remain green.

## 17. Current Function resource evidence

Do not change v2 wire or Rust verifier merely to implement key publication.

If Rust/queries/Function binaries change, rerun the full M4-002 Function resource suite.

If they do not change, bind the exact adopted hashes and prove the source is unchanged.

Stack remains an explicit later G2 supported-profile/release criterion.

## 18. Commercial/FX/artwork activation boundaries

Do not invent:
- production three-plan catalog;
- OXR paid account/key;
- production artwork implementation.

The key/publication implementation may be accepted while these remain deployment/quote-activation prerequisites.

M4 cannot be declared fully rollout-ready from synthetic values.

## 19. Work split

Use actual `sol-6-high`.

Up to two non-overlapping restricted writers:

### Writer A — keys/crypto/readiness
Own key persistence/encryption, rotation/epoch application services, public config builder and signer/readiness integration.

### Writer B — Shopify publication transport
Own fixed metafield Admin adapter, readback/CAS normalization, publication application service and focused synthetic transport tests.

### Integrator
Own migrations/facade, shared contracts, v1.4 governance amendment, Function reconciliation, crash/concurrency tests, bounded live operator, CI and review fixes.

## 20. Acceptance

M4-003 is principal-reviewable when:

1. v1.4 correctly records v2 adoption without weakening gates;
2. signing private keys are encrypted at rest and tenant/install fenced;
3. key rotation and epoch semantics are executable;
4. durable key metadata is consistent with persisted v2 authorization sets;
5. public Function config is deterministically generated from trusted state;
6. Product policy projection is derived from immutable revision/mode;
7. Shopify metafield writes use CAS and exact readback/recovery;
8. caller-supplied arbitrary publication projections are impossible through the production seam;
9. activation remains fail-closed when the safe boundary is unavailable;
10. quote issuance has an explicit key/remote-config/Function readiness gate;
11. no production private key or synthetic public config residue is left on Shopify;
12. all previous M1-M4-002 tests remain green;
13. fresh reviewers report no unresolved material issue.

## 21. Handoff

Return one integrated PR with:
- exact refs;
- v1.4 plan/ledger hashes/history proof;
- key schema/envelope/version;
- rotation/epoch contract;
- public-config and policy canonical examples;
- Shopify CAS/readback fixtures;
- publication-state/recovery results;
- Function readiness model;
- optional live read/mutation register and exact cleanup state;
- final-head CI;
- reviewer dispositions;
- explicit remaining owner activation decisions.

Stop for principal review.

No PR merge, M5, production Function deployment, production signing-key activation, paid FX activation, commercial plan creation, gate pass or launch is authorized.
