# M0-010 — local hybrid billing proof

This is an **off-store synthetic** G8 slice. It does not create a billing plan, contract, meter, App Event or charge. The authoritative business rules are implementation-plan §§6.6–6.8 and decision-ledger v1.2. [Provider contract](provider-contract.md) separates current Shopify documentation from fake responses and unresolved live capabilities.

Run from this directory:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

`BillingApplication` is the public use-case seam. A `SubscriptionPort` supplies an identity-checked current/historical observation and a current submission window; the only implementation here is `FakeSubscriptionPort`. `BillingProof` decides feature entitlement and records an immutable first-paid fact keyed by `(shop, external order, customized_order_paid)`. The same synchronous local operation inserts a pending outbox row for a billable order. `exportSnapshot`/`resume` demonstrate restart with fact/outbox consistency; a production PostgreSQL transaction, uniqueness constraints, worker leases and durable scheduler are **not** implemented.

`FakeAppEvents` receives the exact 2026-07 request body without network access, can simulate a timeout after receipt, and separately processes its queued events with artificial integer-cent tariffs. HTTP `202` changes a row to `TRANSPORT_ACCEPTED` only. Matching fake quantity and cost is labelled `AGGREGATE_MATCH_ONLY`; a provider billing success or per-event charge is not inferred. Mixed-plan cycles require review. Twelve bounded automatic retries are a local policy, after which an operator disposition is required. Post-payment refund, cancellation and restock observations cannot create a negative usage event.

The three `fixture_*` plans and their feature names, allowances and cent amounts are deliberately invented **test values**, not Insignia's offer or a pricing proposal. The provider parser preserves raw decimal unit prices, including a documented three-decimal form; fake arithmetic stays checked integer cents. An upstream purchase/payment verifier and authenticated Partner API/App Events clients remain outside this package. The normalized history port must prove full historical coverage and effective timestamps; otherwise the local fact stays pending. Existing valid buyer offers and retained order access remain owned by their established systems. This billing seam only gates **new** merchant actions; it has no method to revoke old authorization or alter required-customization policy.
