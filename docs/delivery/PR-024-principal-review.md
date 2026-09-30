# PR #24 principal review — APPROVED

## Binding

- Repository: `Optidigi/insignia`
- PR: `#24`
- Base/effective merge base: `b2bf6003da27645b2f182e9d22a6e791e4163a06`
- Approved head: `78c32da34018d6aadf056afb0c3dc391356e7764`
- Approved tree: `284ace7587db052fae5a95d4fedc606fbf4b930b`
- Synthetic merge: `46fe6bf5a8924b436cf81d30d2d30d002c844117`
- Synthetic merge parents: exact base + approved head
- Synthetic merge tree: exact approved tree

PR #23 normal merge `b2bf6003da27645b2f182e9d22a6e791e4163a06` has the exact previously approved parents and tree.

The native GitHub APPROVE attempt returned HTTP 403 and was not posted. This file is the external principal verdict.

## Accepted M4-001 result

M4-001 is accepted at its intended read-oriented provider-contract scope.

Accepted production-owned pieces include:

- Shopify Admin 2026-07 contextual variant pricing and product/variant ownership validation;
- bounded provider reads and finite freshness;
- M3 tenant/install credential fencing before Admin reads;
- Shopify Partner 2026-07 `activeSubscription` normalization;
- exact lexical normalization of tier/usage/discount numeric wire values;
- tenant/install binding of subscription observations;
- fail-closed entitlement projection;
- selected-plan features during active trial with usage suppression and no retrocharge;
- scheduled-cancellation retention of current grants;
- no early grant from pending updates;
- current paid state requiring first-full-payment event-time classification before billing;
- an exact/provenanced/fresh `CustomizationFxProvider` contract;
- cross-package composition tests.

The current policy deliberately grants only configured `EVERY_30_DAYS` hybrid plans. `ANNUAL` state normalizes but fails closed. This is safe and is not a commercial-plan decision.

The provider `price.active` field is preserved as metadata and is not treated as subscription cancellation. The retained development contract confirms the current `activeSubscription` can coexist with `price.active:false` records.

## Live evidence accepted with qualifications

The bounded register records 2/20 Admin GraphQL reads, 1/10 Partner GraphQL read and two separately recorded existing-scope Admin credential exchanges.

The retained optional fixture returned `20.0 USD` for NL, US and GB. This proves provider transport, contextual-price parsing and ownership against the designated store; it does not prove a divergent Markets conversion or fixed-local-price case.

The Partner read preserved the existing effective-zero monthly contract: current 30-day cycle, no active trial, no scheduled cancellation, no pending update, zero flat/usage economics, usage quantity 3.0, and `price.active:false` metadata.

No merchant resource was changed.

## Provider-contract judgment

Current Shopify 2026-07 documentation supports the implementation: contextual variant `price` is the final contextual price; Partner `activeSubscription` exposes trial/cycle/cancellation/items/usage/pending state; and `CurrencySetting` exposes numeric `manualRate` only when a manual rate is active. Therefore contextual garment prices must not be reverse-engineered into an FX rate for customization components.

## Automatic FX direction

No paid provider or commercial terms are approved by this review.

For the next technical slice, the preferred adapter target is the Open Exchange Rates Developer contract. Current published terms expose hourly rates, 10,000 requests/month and arbitrary base currencies at USD 12/month; its FAQ recommends a paid account for commercial/shopping-cart software.

This is a technical integration target only. It does not authorize account creation, payment, terms acceptance, a production credential, or a real provider request. `currencyapi` remains a viable alternate behind the same port.

Cross-currency automatic customization quotes must continue to fail closed when no approved/configured FX source exists.

## Final-head verification

All ten applicable workflows passed on the exact approved head.

The M3 runtime workflow confirms Shopify 64/64, application 25/25 and PostgreSQL 36/36 tests; retained worker/runtime tests are green. The exact-head foundation workflow passed the pinned Rust/Function/browser/history suite. The inherited local Polaris timeout is a host limitation, not a PR #24 blocker.

Fresh Spec/correctness and Standards/security reviews found five issues on an earlier candidate; all were corrected. Fixed-ref rereviews found no remaining material issue. The final production source was unchanged after those rereviews; the last commit adds cross-package composition coverage/evidence.

## Limits

This approval does not select/purchase an FX service, define the production three-plan catalog, implement quote acceptance, implement production signing-key lifecycle, adopt whole-quote v2, publish Shopify policy/key state, complete G1-G8, or complete M4.

M4-002 is separately authorized by the accompanying brief.
