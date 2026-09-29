# M2-001 — Configuration identity and executable pricing kernel

## Authorization scope

This is the first M2 implementation slice after the exact approved merge of PR #20.

It is a **pure/offline production-domain slice**. No authenticated Shopify/provider calls, database setup, R2, worker queues, deployment, previews, merchant resources, secrets, billing configuration or commerce mutations are part of this package.

Architecture v1.3 and the authoritative decision ledger remain unchanged.

## Goal

Implement the production-owned, versioned domain/contracts needed to deterministically answer:

> Given a published configuration revision, a complete set of buyer customization groups, contextual real-variant base prices, and an explicit currency/FX resolution, what exact pre-discount customized merchandise economics are accepted and how are those economics deterministically materialized across real variant units?

The result must be browser-independent, persistence-independent and platform-independent.

## Outcome of this PR

Create a coherent first production pricing slice containing:

1. configuration/pricing value model;
2. canonical customization identity;
3. complete customized-order quantity aggregation;
4. additive setup and unit pricing;
5. all-units quantity tiers;
6. explicit presentment-currency resolution inputs;
7. exact Money arithmetic;
8. deterministic setup/customization allocation to real-variant unit buckets;
9. immutable proposal/quote economics;
10. versioned browser-safe serialized contracts;
11. executable invariants and property tests.

Do not build persistence, Shopify adapters, UI editors, signer/key management or full quote acceptance workflows yet.

## Locked semantics to implement

### Product/config revision boundary

A customization group belongs to:
- one merchant product identity;
- one immutable published configuration revision.

Variant/color/size quantities may aggregate inside one group when the production customization is otherwise identical.

Configuration revisions are immutable inputs to pricing. This slice does not implement mutable drafts or publication storage.

### Customization identity

Canonical production-design identity includes all choices that change production, including:
- selected placements;
- decoration method per placement;
- selected merchant decoration size/step;
- artwork revision identity per placement, or explicit logo-later intent;
- any other published production option represented by this pricing/config contract.

Quantity is **not** part of design identity.

Different design/customization means a different group.

Two independent logo-later purchases with unknown future designs must not auto-merge merely because both lack artwork. Model an explicit deferred-design intent/nonce so reuse is deliberate.

Canonicalization must:
- use explicit schema/versioning;
- sort by stable IDs;
- not depend on JS object/Map insertion order;
- be testable independently from hashing.

### Setup pricing

Support additive setup concepts:
- general setup;
- decoration-method setup;
- placement setup;
- size/step setup when represented by the published rule set.

Each applicable setup component is charged **once per customization group**.

It is not charged per unit, per Shopify variant, per color, or per materialized price bucket.

One group containing e.g. red Small and black Large units therefore still incurs one applicable setup set.

Do not deduplicate setup fees across separate customization groups or products.

### Unit pricing

Support additive customization unit components at least for:
- method/unit;
- placement unit/adjustment;
- size/step unit.

The published model may express fixed values or tiered values where applicable.

Method/unit multiplicity must remain explicit/configurable rather than being inferred from number of placements.

### Order-wide quantity tiers

Let `Q` be the **total Insignia-customized physical quantity across the complete order**, across every customization group and product.

Unrelated plain Shopify merchandise is excluded.

Every customization unit component governed by quantity tiers resolves its **all-units tier** using this same order-wide `Q`.

A material customized quantity/configuration change reprices the complete customized subset.

There is no line-local tier lock.

### Contextual base merchandise

Real-variant contextual merchandise prices are explicit pricing inputs.

Domain code does not fetch Shopify catalog or Markets data.

For every customized unit:

`accepted pre-discount merchandise = contextual base merchandise + customization economics`

Shopify discount/tax/shipping/duty calculation is outside this domain slice.

### Currency and FX

Merchant customization rules originate in shop currency unless a specific presentment-currency override exists.

When conversion is required, pricing receives an explicit resolved FX input containing enough information to reproduce the result, e.g. source/rate/version/observed-or-effective marker as required by the existing architecture.

No hidden provider lookup or clock is allowed.

An explicit currency override for a component bypasses automatic FX conversion for that component.

Accepted proposal economics retain resolved currency/FX provenance.

Support exact 0-, 2- and 3-decimal currencies under the existing Money constraints.

Do not silently round excess input precision.

### Exact totals and materialization allocation

No floating-point money.

Economic breakdown must keep setup fees explicit concepts.

For Shopify materialization, produce deterministic **real-variant unit-price buckets** whose total exactly equals the accepted proposal total.

Allocation invariants:
- every minor unit is conserved;
- no synthetic fee product/line;
- deterministic independent of incidental input ordering;
- variant partitioning never creates an extra setup fee;
- non-divisible setup remainders are assigned deterministically;
- equivalent canonical input produces byte/value-equivalent allocation ordering;
- allocation rows contain enough domain-neutral identity for later authorization without embedding Shopify DTOs.

The allocation algorithm must define and test its tie-break order explicitly.

## Suggested production package shape

Use the existing package boundaries. Add only concrete modules required now.

```text
packages/domain/
  src/config/
  src/customization/
  src/pricing/
  src/quote/

packages/contracts/
  src/v1/
  # Zod 4 schemas for serialized browser/process DTOs introduced by this slice

packages/application/
  # only the narrow proposal/pricing use-case boundary if a concrete second layer
  # is useful; do not create empty repository/service abstractions
```

Domain may not depend on contracts/Zod/application.

Contracts may depend on exported browser-safe domain values where appropriate.

Application may depend inward on domain/contracts.

Do not add database/shopify/artwork adapters in this slice.

## Deterministic evaluation order

Implement and document an executable order equivalent to:

1. Validate schema/version and published pricing/config references.
2. Canonicalize groups and compatible variant quantity vectors.
3. Compute order-wide customized quantity `Q`.
4. Resolve the tier selected by `Q` for every tiered customization rule.
5. Resolve customization component presentment values using explicit currency override or explicit FX input.
6. Price contextual base merchandise by variant quantity.
7. Price additive customization unit components.
8. Add applicable setup components once per customization group.
9. Sum exact group and complete customized-subset totals.
10. Deterministically allocate customization/setup economics over real-variant units/buckets.
11. Assert exact conservation.
12. Construct immutable proposal economics and canonical breakdown.

Missing required references, unsupported versions, invalid tier schedules, duplicate stable IDs, missing contextual prices, unresolved FX, invalid currency exponent or overflow must fail explicitly. No silent economic defaults.

## Mandatory examples

### A — one design across variants

One customization group:
- 10 red Small;
- 15 black Large;
- same design.

Setup:
- general = 20.00
- method = 10.00
- placement = 5.00

Expected setup = **35.00 once**.

Changing how the same 25-unit group is partitioned among compatible variants must not create another setup fee.

### B — complete-order 500 tier

Use at least two products/customization groups whose customized physical quantity totals exactly 500.

Verify every tiered customization unit component uses the 500-unit tier.

Add unrelated ordinary merchandise and prove `Q` is unchanged.

Remove enough customized units to cross below the threshold and prove the entire customized subset reprices to the lower tier.

### C — non-divisible setup allocation

Carry forward the difficult exact-allocation behavior from the reviewed spike evidence.

Use setup/customization minor units that do not divide evenly over physical units.

Prove exact conservation and stable deterministic remainder assignment.

### D — separate design, separate setup

Same product and revision, but different artwork and/or placement/method choice.

Expected: distinct customization groups; each receives its applicable setup once.

### E — logo-later isolation

Two newly created unknown logo-later intents remain distinct.

A deliberately reused deferred-design identity may aggregate when every other production choice is identical.

### F — FX conversion and explicit override

At least:
- one shop-currency component converted through explicit FX input;
- one explicit presentment-currency override.

Prove override bypass and stored resolved provenance.

### G — currency exponent edges

Include 0-, 2- and 3-decimal currencies.

Reject excess precision rather than silently rounding it.

### H — contextual base variation

Two compatible variants in the same customization group with different contextual garment base prices.

Setup still occurs once; each unit's accepted price preserves its own contextual base plus allocated customization economics.

## Property/invariant testing

Property-based tests are encouraged where they materially improve assurance. If adding a property-testing library, choose a maintained TypeScript library, pin the exact version and justify it in the PR.

Required properties include:
- allocated total equals accepted customized merchandise total exactly;
- group setup count is invariant under compatible variant partitioning;
- canonical reorderings do not alter identity, total or allocation order;
- equivalent quantity splitting/combining for the same real variant does not change economics;
- plain unrelated quantity never changes `Q`;
- customized quantity threshold changes reprice every affected group's tiered unit components;
- identity changes for every production-design change;
- identity does not change for quantity-only changes;
- invalid/negative/overflow amounts cannot become accepted output;
- allocation cannot produce zero/negative physical quantities or lose a variant quantity.

## Contracts/versioning

Introduce explicit serialized version identifiers for DTOs created here.

Use Zod 4 only at serialization boundaries.

Unknown future schema versions must reject.

Do not freeze a larger public HTTP API than this slice needs.

Canonical identity must not be defined as "hash whatever JSON.stringify happens to produce". Define canonical values/ordering first, then hash only if a concrete identity key is needed.

## Compatibility with M0/M1 evidence

Reuse reviewed exact-money/allocation semantics by migrating narrow production logic, not by importing `spikes/` at runtime.

No production code may contain:
- M0 fixture app/store/product IDs;
- `_insignia_fixture_role`;
- old live quote carriers;
- test private keys;
- legacy storefront implementation;
- Shopify GIDs as required domain identity types.

Experimental v2 authorization remains **not adopted**. Pricing may emit deterministic allocation records suitable for a future signer, but this PR must not implement production signing or make v2 authoritative.

## Boundary and CI requirements

Extend the existing root `pnpm check`; do not create a disconnected test path.

The final-head normal suite must cover:
- formatting/lint/type/build;
- domain unit tests;
- pricing worked examples;
- property/invariant tests;
- contracts validation/version rejection;
- M1 ambient-effect/domain-import guards;
- secret/fixture provenance;
- existing Rust/Function regressions;
- historical integrity.

Add targeted negative boundary probes demonstrating new domain code cannot import or use:
- Shopify SDK/platform DTOs;
- Astro/Preact/Konva;
- database/filesystem/network;
- clocks/randomness/environment globals.

## Scope discipline

Do **not** implement in M2-001:
- PostgreSQL schema/repositories/migrations;
- pg-boss;
- Shopify API clients;
- App Proxy;
- admin UI/editor;
- storefront workflow;
- artwork handling;
- Ed25519 issuer/private-key storage;
- Function deployment/publication;
- billing entitlements;
- merchant plan features;
- webhooks;
- host/deployment infrastructure.

Do not invent commercial plan names/prices/allowance values.

Do not reopen settled semantics merely to generalize abstractions.

## Agent/workstream shape

Use actual `sol-6-high`.

Recommended bounded delegation:

### Writer A — configuration/customization identity
Own:
- versioned config/pricing rule value types;
- canonical customization identity;
- logo-later identity;
- contracts schemas for those values.

### Writer B — pricing/allocation
Own:
- Money extensions only where required;
- tier evaluation;
- FX input resolution;
- group/order pricing;
- deterministic allocation;
- worked examples/property tests.

### Integrator
Own:
- root/package manifests and lockfile;
- package exports;
- shared IDs/interfaces between A/B;
- application proposal boundary if needed;
- CI/boundary integration;
- review corrections.

Writers must use separate worktrees and must not both modify shared manifests/exports.

Use fresh read-only Spec/correctness and Standards/security reviewers on the integrated branch.

## Acceptance

M2-001 is acceptable when:

1. all mandatory examples are executable and pass;
2. exact totals and deterministic allocation are property/invariant tested;
3. one customization across multiple variants never gains setup fees from partitioning;
4. order-wide tier quantity behavior is explicit and tested across groups/products;
5. FX/override handling is explicit-input and reproducible;
6. customization identity is canonical/versioned and quantity-independent;
7. serialized contracts reject unknown versions/malformed data;
8. domain remains platform/network/persistence/clock/randomness independent under the executable M1 guards;
9. a clean frozen checkout passes the complete root suite and final-head CI;
10. fresh reviewers report no unresolved material defect.

## Stop conditions

Stop for principal direction if implementation discovers that a locked pricing/identity semantic is contradictory or cannot be represented without materially changing the plan.

Ordinary implementation bugs, test gaps and reviewer findings remain in scope to fix locally.

Do not start M3, merge this PR, adopt v2 or mutate Shopify resources.

## Handoff

Return one integrated M2-001 PR with:
- base/head/effective merge base;
- concise package/dependency changes;
- worked-example results;
- property-test summary;
- schema versions introduced;
- any exact semantic ambiguity encountered;
- clean/frozen local command results;
- final-head CI;
- fresh reviewer dispositions;
- confirmation that no authenticated external resource was touched.

Stop for principal review.
