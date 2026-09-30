# M4-002 — accepted quote authority and whole-quote production candidate

## Status

Authorized only after the exact approved normal merge of PR #24.

This is a bounded M4 slice. It creates production-owned accepted-quote authority and migrates the proven whole-quote candidate out of spike-only TypeScript. The resulting protocol remains a **candidate** until principal review.

No Shopify write, production signing-key publication, paid FX activation or M5 work is authorized.

## Goal

Produce one programmatic immutable accepted quote from trusted/fresh M2/M3/M4 inputs and convert its complete customized subset into the existing whole-quote v2 authorization bytes without changing the wire.

Target local flow:

```text
active tenant/install
+ immutable config revisions
+ buyer desired country/market context lock
+ fresh Shopify contextual garment prices
+ fresh recognized entitlement
+ explicit customization FX/overrides
        ↓
M2 exact order-wide pricing
        ↓
capacity admission
        ↓
immutable accepted quote
        ↓
whole-quote v2 signer port
        ↓
persisted authorization set
        ↓
existing Rust Transform + Validation verify the same economics
```

## 1. Preserve the candidate wire exactly

Keep byte-for-byte compatibility with `spikes/m0-005/contract.md` and `crates/cart-authorization/src/whole.rs`:

```text
DOMAIN  Insignia\0WholeQuoteAuthorization\0v2\0
magic   ISG2
version 2
flags   0
header  92 bytes
member  22 bytes
```

Keep `_insignia_quote_v2` and `_insignia_member_v2` carriers, ordinary Ed25519, canonical unpadded base64url, complete-set ordering and all existing field meanings.

A required wire/semantic change is a principal stop condition.

## 2. Production-owned authorization package

Create a concrete server package such as `packages/cart-authorization`.

It owns:
- TypeScript header/member types;
- canonical encoder/decoder;
- carrier generation;
- complete-set ordering;
- signature input bytes;
- candidate capacity admission;
- `AuthorizationSigner` port;
- test/inspection helpers.

Runtime code must not import `spikes/`.

Generate committed versioned vectors from production TypeScript and verify them with the TS decoder, `crates/cart-authorization`, the complete Transform target and complete Validation target.

## 3. Durable installation authorization identity

The v2 16-byte `generation` must map to the durable M3 installation generation, not an ephemeral request value.

Add one immutable random UUID/16-byte authorization-generation identity per `(shop, installation generation)`.

Requirements:
- current rows migrate safely;
- reinstall gets a new UUID;
- old UUID is never reused;
- application/database owns creation;
- buyer cannot supply it;
- checked u32 authorization epoch, if persisted, is scoped to that exact installation generation.

Do not encode the numeric M3 generation string directly into this 16-byte field.

## 4. Buyer country/Market is a context lock, not pricing authority

The storefront may provide the current country and `localization.market.id`.

Treat both as **untrusted desired checkout context**.

Accept ISO country and either a numeric Market ID or strict `gid://shopify/Market/<u64>` form.

Security invariant:
1. server calculates garment economics from the requested country through the trusted M4 contextual-pricing adapter;
2. provider contextual currency becomes authoritative presentment currency;
3. country + normalized Market ID are signed;
4. both Functions compare them to their actual trusted localization context.

A manipulated buyer claim may make a quote unusable, but must not create an underpriced quote valid in another actual checkout context.

Do not add `read_markets` merely to authenticate this lock in M4-002.

Add adversarial tests for changed country/Market before and after issuance.

## 5. Shop quote context

Add a read-only Shopify shop-context adapter, or extend the current read contract cleanly, for exact active tenant/install scope.

Normalize at least:
- provider Shop GID;
- shop currency;
- IANA timezone.

Use an injected UTC clock and the IANA timezone to derive the shop-local calendar date. Define/test the ordinal conversion independent of server timezone and DST.

For acceptance on local date `D`:

```text
validThroughDay = ordinal(D + 2 calendar days)
```

This matches the existing Function `E-2..E` three-shop-local-day window. Do not replace it with elapsed 72 hours.

## 6. Currency exponent matrix

Replace the Rust USD/EUR/JPY/KWD test table with one explicit versioned candidate currency/exponent matrix shared/generated consistently between TypeScript and Rust.

Requirements:
- integer exponents only;
- known 0-, 2- and 3-decimal currencies supported where unambiguous;
- unknown, `XXX`, unsupported digital/non-standard or ambiguous legacy values reject rather than guess;
- TS/Rust agreement test for every admitted code;
- no floating-point money.

Do not assume every Shopify `CurrencyCode` enum member is automatically safe.

Any Rust table change requires final Function rebuild/resource evidence.

## 7. Open Exchange Rates adapter target

Implement a concrete Open Exchange Rates adapter behind `CustomizationFxProvider`, using synthetic HTTP fixtures only.

No real OXR account/key/request/payment is authorized.

Contract:

```text
GET https://openexchangerates.org/api/latest.json
  ?app_id=<injected>
  &base=<shopCurrency>
  &symbols=<presentmentCurrency>
  &prettyprint=0
```

The adapter must:
- require exact HTTPS provider host/path;
- require injected App ID;
- bound response size/time;
- reject redirects;
- verify response base;
- require the requested rate;
- parse rate JSON numerically/lexically without binary JS float authority;
- require finite positive exact decimal;
- use provider UNIX `timestamp` as rate publication/effective provenance;
- return stable source/version/provenance;
- apply explicit finite freshness policy;
- classify auth/429/network/5xx/malformed/missing pair;
- never silently serve an expired fallback.

Changing base is a paid-plan capability. Do not silently fall back to USD and derive a cross-rate.

Same-currency customization requires no FX call. Explicit presentment-currency overrides continue to bypass automatic conversion for covered components. If conversion is required and no approved source exists, quote acceptance fails closed.

## 8. Immutable accepted quote persistence

Add dbmate-owned persistence for immutable accepted quotes.

One quote represents the **entire customized subset being accepted**, potentially with multiple groups/products/revisions.

Use an explicit schema such as `m4-accepted-quote-v1` and persist enough trusted information to reproduce/audit:
- tenant shop ID;
- installation generation and authorization-generation UUID;
- quote UUID;
- accepted timestamp;
- local accepted date + valid-through ordinal;
- country + normalized Market numeric ID;
- shop currency/timezone;
- presentment currency/exponent;
- recognized entitlement policy/trial disposition;
- immutable ProductConfig revision ID + content hash per group;
- canonical customization identity per group;
- exact variant quantities;
- contextual garment snapshots/digests;
- FX snapshot/provenance where used;
- M2 breakdown;
- quote-global deterministic allocation buckets;
- total customized physical quantity;
- total pre-discount minor units.

DB enforcement must reject update/delete of economic quote content.

Do not persist provider/admin credentials, FX App IDs or private signing material in the quote.

## 9. Immutable authorization-set persistence

Persist the exact signed result separately.

Suggested concepts:

```text
accepted_quote
quote_authorization_set
```

Authorization set binds quote UUID, set UUID, key ID, epoch, valid-through ordinal, exact envelope carrier, ordered member carriers/index association and creation timestamp.

Rows are immutable.

A renewal/re-sign may use a new set UUID but may not extend the accepted quote's fixed `validThroughDay`.

## 10. Quote authority application service

Create a concrete use case such as `acceptQuote()`.

Input includes active tenant/install identity, complete desired customization groups and quantities, desired country/Market lock, capacity projection hints and idempotency key.

Require in order:
1. active M3 tenant/install;
2. recognized fresh M4 entitlement;
3. immutable published/effective ProductConfig revision for every group;
4. fresh exact contextual prices for every real variant/product/country;
5. one presentment currency across customized subset;
6. no paid customization selling plan;
7. usable override/same-currency/FX path;
8. M2 whole-order pricing/allocation;
9. candidate capacity admission;
10. signer key valid for full quote window;
11. immutable quote + authorization persistence under command idempotency.

Recheck active tenant/install and entitlement immediately before signing/persistence after provider reads.

A reinstall/deactivation between reads and acceptance must fail closed.

Do not emit billing usage. `REQUIRES_EVENT_TIME` remains M9 purchase-time classification.

## 11. Only immutable published/effective revisions

Never price from mutable drafts.

Use only immutable M3 revisions that are trusted for the requested ProductConfig. If the required effective/publication state is unavailable, fail closed.

Do not expose internal publication staging to make tests pass. Internal test fixtures may establish effective revisions.

## 12. Candidate capacity admission

Migrate the useful M0-013 logic into production-owned code.

Hard candidate guards remain:

```text
customized price buckets <= 32
relevant cart lines      <= 200
customized physical qty  <= 10,000
Transform output internal profile <= 16,000 bytes
```

These are engineering admission limits, not plan limits or merchant-facing caps.

Browser/current-cart projection may provide ordinary-line count and input byte estimates. Treat these as untrusted **availability hints**, not authorization authority. Under-reporting may cause downstream Function rejection but must never alter signed economics or bypass hard customized-subset limits.

Never sign a partial customized subset merely to fit capacity.

## 13. Signer port

Define a production application/server port such as:

```ts
AuthorizationSigner.signWholeQuote(input) -> {
  keyId,
  publicKeyFingerprint,
  firstValidDay,
  lastValidDay,
  signature
}
```

Require signer-reported validity to cover D..D+2.

M4-002 may provide deterministic synthetic/test signer plus a production adapter for an injected Ed25519 private-key provider.

Do not generate/use a live signing key or publish a public key to Shopify. Do not commit private seed/PKCS8 bytes.

Encrypted key lifecycle/rotation/publication is later M4 work.

## 14. Function compatibility and resource evidence

Run production-issued vectors through both complete Functions.

Required cases include:
- 1 bucket;
- 10 customized + 190 ordinary;
- 32 + 168;
- 33 rejected before signing;
- 10,000 physical units over few buckets;
- multiple products/groups/revisions;
- setup remainder allocation;
- country/Market/currency change;
- epoch/generation change;
- revoked/out-of-window key;
- missing/duplicate/reordered member;
- wrong variant/quantity/final price;
- selling-plan conflict.

If Rust/currency-table code changes, rebuild and measure final Wasm. Capture final hashes/bytes, 10+190 and 32+168 instruction/input/output numbers, linear memory, query size/cost and explicit stack status.

Do not call 32 a universal merchant capacity.

## 15. Runtime composition seam

Add one server-side composition test/seam proving M4-001 catalog + entitlement, M3 tenant/database, M2 pricing, FX port and M4-002 quote authority can be wired without adapter-internal imports.

The App Proxy buyer quote route/UI may remain M7 if necessary to keep scope bounded.

## 16. Commercial-plan boundary

Do not invent production three-plan handles, prices, features or included usage.

Use explicit synthetic policy configuration in tests.

If owner commercial catalog is still absent at review time, record it as an M4 completion blocker. The zero-dollar development contract remains evidence only.

## 17. Optional external read allowance

After local tests, one serialized operator may use the designated Public/Draft app/store for at most:
- 3 Admin GraphQL reads;
- 1 Partner `activeSubscription` read;
- 2 necessary existing-scope Admin credential exchanges.

Allowed read purpose: `shop { id currencyCode ianaTimezone }`, retained contextual ownership/prices, current activeSubscription if needed.

No `read_markets`, scope change, reauthorization, mutation, preview/deployment, App Events token, billing event, product/Market/cart/order operation or OXR request/account.

Existing credential files may be read only under owner launch authorization and must never be printed/committed/modified.

## 18. Package boundaries

Preserve domain purity, no adapter-to-adapter imports, browser/server separation, opaque database facade, dbmate application migration ownership, pg-boss separate schema ownership, Shopify SDK isolation and no runtime spike imports.

`packages/cart-authorization` must not depend on Shopify/network/database adapters.

## 19. Work split

Use actual `sol-6-high`.

At most two non-overlapping writers:

### Writer A — quote authority/persistence
Own application quote service, quote schema/value, DB migration/repository through safe facade, shop context abstraction and M2/provider composition tests.

### Writer B — authorization/FX
Own production TS v2 encoding/admission, signer port/test signer, TS/Rust vectors, currency exponent matrix and OXR adapter synthetic fixtures.

### Integrator
Own shared exports/lockfile, authorization-generation identity, server composition, cross-workstream tests, Function artifact/resource checks, optional live read and review corrections.

Fresh read-only Spec/correctness and Standards/security review required after integration.

## 20. Acceptance

M4-002 is principal-reviewable when:
1. programmatic quote persistence is immutable and exact;
2. production TS generates canonical candidate v2 without spike runtime imports;
3. both Rust Functions accept positive vectors/reject adversarial changes;
4. three shop-local calendar days are DST-safe/deterministic;
5. untrusted country/Market claims cannot create valid economic mismatch;
6. contextual garment price remains provider authority;
7. same-currency works without FX;
8. cross-currency fails closed without configured FX;
9. OXR synthetic adapter returns exact timestamped provenance;
10. signer validity/generation/epoch check before persistence;
11. quote/auth rows tenant/install fenced and immutable;
12. hard candidate admission rejects unsupported subset before signing;
13. final Function resources remain within retained candidate envelope or regression is explicitly returned;
14. no real signing/FX credential is used;
15. all prior CI remains green;
16. fresh reviewers report no material unresolved issue.

## 21. Decisions intentionally deferred to principal/owner

Do not decide inside implementation:
- formal whole-quote v2 production adoption;
- production merchant capacity;
- paid FX account/credential activation;
- production signing-key storage/rotation/publication;
- final commercial three-plan catalog.

## Stop conditions

Return for principal direction if the wire cannot represent production M2 semantics, current Functions require a wire change, provider currencies conflict across subset, effective-revision invariant needs redesign, resources regress materially, a buyer value must be trusted without independent Function verification, or a live mutation/new scope/provider purchase is required.

Ordinary implementation/test/review fixes remain in scope.

## Handoff

Return one integrated PR with exact refs, migrations/schema, quote version, local-day definition, Market trust explanation, currency matrix, OXR synthetic contract, accepted quote/auth example, TS/Rust vector results, final Function resource evidence, optional read register, CI, review dispositions and explicit remaining owner/principal decisions.

Stop for principal review.

No PR merge, v2 adoption, merchant-capacity adoption, live FX activation, live key publication, M5 or launch is authorized.
