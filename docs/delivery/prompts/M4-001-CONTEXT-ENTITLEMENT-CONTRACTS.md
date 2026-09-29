# M4-001 — Shopify context and App Pricing contract normalization

## Status

Authorized only after the exact approved normal merge of PR #23.

This is a bounded **read-oriented M4 adapter slice**. It is deliberately before the production signer/protocol slice.

No whole-quote v2 adoption, Function deployment, publication mutation, billing event, plan mutation, subscription mutation, purchase or checkout is authorized.

## Goal

Replace two remaining spike assumptions with production-shaped, current Shopify contracts:

1. **Catalog/context pricing** — prove and implement how Insignia obtains the real merchant variant and its contextual pre-discount garment base price for supported market context.
2. **App Pricing entitlement projection** — prove and implement how Insignia reads the merchant's current Shopify App Pricing subscription, trial, cancellation, pending update, items and usage without deriving state from local billing events.

The result must expose explicit normalized snapshots and fail closed on missing/stale/unknown authority.

## Recheck current Shopify contracts first

At implementation start, research the latest stable Shopify docs/schema and pin the API version used. Do not treat this prompt as a substitute for current provider verification.

Expected current contract at authorization time:

### Admin contextual pricing

`ProductVariant.contextualPricing(context: ContextualPricingContext!)` returns the final contextual `MoneyV2` price/currency for a variant and requires `read_products`.

As of API 2025-04+, only active Markets participate in contextual resolution.

The returned price can reflect conversion, merchant fixed local prices and other contextual adjustments. It is therefore authoritative **contextual garment base pricing**, not a raw FX rate.

### Market currency settings

`CurrencySetting` exposes `currencyCode`, `enabled`, optional `manualRate`, and `rateUpdatedAt`.

The documented object does not expose a numeric current automatic exchange rate when `manualRate` is null.

Therefore **do not derive customization FX from contextual garment-price ratios**. Price lists, local fixed prices, adjustments and rounding can make that ratio wrong.

### Shopify App Pricing

For a public app, Partner API `activeSubscription(appId, shopId)` is the authoritative current subscription contract. It exposes billing period, `cancelAtEndOfCycle`, `trialEndsAt`, `currentBillingCycle`, subscription items/prices/usage/discounts and `pendingUpdate`.

During trial, current docs show `currentBillingCycle = null` and `trialEndsAt` populated. No active contract returns `null`.

Recheck all of this in current docs/schema before coding.

## Workstream A — contextual catalog adapter

Build the production Shopify Admin GraphQL catalog/context adapter in `packages/shopify`.

Application-facing APIs must be domain-neutral and require explicit tenant/install identity. Provide an operation equivalent to:

```ts
resolveVariantContext({
  shopId,
  installationGeneration,
  productId,
  variantIds,
  context
})
```

For M4-001 prioritize country context. Do not invent B2B/company support unless the current schema and product scope require it.

### Output per variant

Return:
- external product ID;
- external variant ID;
- proof/field that the variant belongs to the requested product;
- contextual final amount as an exact decimal string;
- contextual currency code;
- source API version;
- explicit context;
- observed-at timestamp supplied by application/injected clock;
- safe provider correlation metadata.

Never use JavaScript floating point for money.

### Ownership

A variant must be proven to belong to the requested merchant product. Unknown, missing or mismatched variants reject. Buyer-supplied product/variant relationships are not authoritative.

### Batching

Use bounded GraphQL batching/nodes/aliases or a documented equivalent. Avoid N+1 requests for normal size/color vectors. Define explicit batch ceilings and handle partial/missing nodes and GraphQL throttle/cost errors.

### Freshness

Introduce a normalized contextual-pricing snapshot with explicit observation/freshness metadata. Do not cache one market's price as a universal variant price or accept an indefinitely stale snapshot.

## Workstream B — App Pricing activeSubscription adapter

Implement a read-only Partner API client behind an application port. Use the current stable Partner GraphQL API version.

Normalize at least:
- no active subscription;
- billing period;
- `cancelAtEndOfCycle`;
- `trialEndsAt`;
- current billing cycle start/end;
- every item: handle, price typename, active flag, currency, flat amount, tier mode/tiers, current usage quantity/cost, discount;
- pending update billing period/item handles;
- observation timestamp/source version.

Do not depend on item array order. Handles are case-sensitive provider identity. Duplicate handles or contradictory provider state fail closed.

### Trial policy — locked Insignia behavior

During the selected plan's live trial:
- grant the selected plan feature set;
- **do not emit per-order billable usage**;
- do not accumulate hidden trial usage for retroactive charging;
- never retrocharge it when trial ends.

Represent this explicitly, e.g. `billableUsageAllowed: false`.

Do not infer trial from install age; use authoritative subscription fields.

### Scheduled cancellation

While `activeSubscription` still returns the current contract with `cancelAtEndOfCycle = true`, retain its current feature entitlement and mark scheduled cancellation explicitly. Once Shopify no longer reports an active subscription, do not grant paid entitlement. Do not invent a local grace period.

### Pending update

`pendingUpdate` is future state. Do not grant future-plan features early; expose it separately.

### Effective-zero development contract

The private development subscription can legitimately contain effective zero prices. Do not infer commercial tariff from those values. Keep provider economics separate from Insignia feature policy.

## Workstream C — entitlement feature-policy structure

Create a production feature-policy interface without inventing commercial plan names/prices/features not yet configured by the owner.

Use configuration-driven plan handles and obvious synthetic handles in tests.

The retained private handle `insignia-dev-zero-20260928` may appear only in development/evidence configuration, never hard-coded as a commercial tier.

Unknown plan handles fail closed for paid feature entitlement.

The normalized result should expose at least:
- active/no subscription;
- recognized plan-policy ID;
- trial state;
- current feature grants;
- app-configured included usage allowance policy;
- observed Shopify usage quantity;
- whether a new qualifying usage event is billable/allowed;
- scheduled cancellation;
- pending provider update;
- freshness/observation metadata.

Do not send App Events in this slice.

## Workstream D — provider projection persistence

Add a small dbmate migration only if required for safe runtime behavior.

A persisted provider projection should be tenant/install scoped and include source API/version, observation time, normalized versioned contract, digest, freshness/revalidation deadline and bounded error state where useful.

It must never become permanently authoritative. Stale/missing projection must fail quote/publication eligibility or require refresh.

Do not store Partner credentials in projection tables.

## Workstream E — automatic customization FX boundary

M2 already accepts explicit resolved FX input. M4-001 must make the automatic-FX gap an explicit production port and decision record.

### Required conclusion

- Shopify contextual garment pricing is not the customization FX source.
- `CurrencySetting.manualRate`, if intentionally available later, can represent an explicit merchant manual rate.
- the documented Shopify currency-setting contract does not expose the numeric automatic rate needed to convert arbitrary customization values when `manualRate` is null.

### Implement

Add a `CustomizationFxProvider` port with explicit:
- shop currency;
- presentment currency;
- exact decimal/rational rate;
- source and source version;
- observed/effective timestamp;
- freshness/expiry;
- provenance suitable for quote freezing.

Do not implement a fake rate.

### Research output

Research at least 2–3 credible current production automatic-FX sources and return a concise recommendation covering API/data source, supported currencies, rate semantics, update cadence, SLA/terms, account/credential requirement, public cost tier if available, failure behavior and fit for Insignia.

Use community/operator evidence alongside vendor documentation.

**Do not create an account, accept paid terms, spend money or add credentials.** If no provider is selected, keep automatic FX as a named later M4 blocker while merging only the port/contracts.

## Workstream F — bounded live read-only evidence

Use only the designated Public/Draft app and rewrite development store:

- App GID `gid://shopify/App/429028933633`
- Shop GID `gid://shopify/Shop/105501393179`
- Store `insignia-rewrite-dev.myshopify.com`

### Existing credential authorization

The operator may read only these existing credentials for the bounded read-only experiment:

- `/home/serveradmin/.local/share/insignia-public-app/server.env`
- `/home/serveradmin/.local/share/insignia-public-app/partner-read.env`

Never print, commit or modify credential values.

### Admin reads

At most **20 read-only Admin GraphQL requests**.

Use existing scopes only. No scope changes/reauthorization.

Read one or a small bounded set of existing rewrite-dev product/variant IDs and query:
- product/variant ownership;
- `contextualPricing` for a small country matrix.

Prefer NL, US and GB if the store's active Markets make those contexts valid. If contexts are unavailable or prices/currencies are identical, report actual behavior; do not mutate Markets to force diversity.

No product, Market, price-list, inventory, discount, cart or order mutation.

### Partner reads

At most **10 read-only Partner API requests** using the existing Partner read credential.

Query the designated app/shop `activeSubscription` only. No App Pricing mutation. No billing event. **No App Events token acquisition.**

Bind a sanitized raw-response shape/digest and normalized projection. Compare current development contract to retained M0-012 evidence without changing it.

### No read_markets scope expansion

Do not request `read_markets` or any other new scope. If it already exists, do not use it without explicitly recording the grant and staying read-only.

The schema/docs for `CurrencySetting` may be researched without adding store scopes.

## Required fixtures/tests

### Context pricing

Cover:
- same variant across at least three synthetic contexts/currencies;
- fixed local contextual price differing from a simple FX ratio;
- product/variant mismatch;
- missing variant;
- partial GraphQL response;
- stale snapshot;
- exact decimal preservation;
- throttling/network/provider error classification.

### Subscription

Fixtures for:
1. no active subscription;
2. active monthly contract;
3. active trial (`trialEndsAt != null`, no current billing cycle);
4. scheduled cancellation;
5. pending update;
6. flat + usage item;
7. VOLUME tiers;
8. GRADUATED tiers;
9. discounts;
10. zero-effective development contract;
11. duplicate/unknown handles;
12. malformed contradictory provider response.

Assert:
- trial grants plan features but `billableUsageAllowed = false`;
- no retroactive trial-usage ledger entry is produced;
- pending update does not grant early;
- scheduled cancellation retains current entitlement while provider still reports active contract;
- array reordering has no effect;
- provider decimals remain exact strings.

### Freshness

If projections are persisted: test tenant isolation, stale rejection, reinstall fencing and refresh race ordering.

## Provider error taxonomy

Admin classes should include missing/inactive credential, refresh/reauth, 401/403, 429/throttle, network/timeout, GraphQL error, missing resource and invalid money/provider shape.

Partner classes should include auth/permission, app-not-public, shop-not-found, feature-unavailable, no-active-subscription (normal state), 429, network/timeout and malformed provider response.

No secrets in errors/logs.

## Observability and boundaries

Use existing Pino/prom-client with bounded labels only.

Only `packages/shopify` contains Shopify Admin/Partner transport implementation. Application owns ports/policy. Domain stays Shopify/network/persistence-free. Browser code cannot reach credentials. Adapters do not call one another directly; application/composition root orchestrates them.

## Work split

Use actual `sol-6-high`, at most two non-overlapping restricted writers and one integrator.

### Writer A — catalog/context
Own Admin contextual-pricing adapter, catalog/context port/model and fixtures.

### Writer B — entitlement
Own Partner activeSubscription client, normalized entitlement policy and trial/cancel/pending fixtures.

### Integrator
Own package exports, persistence/freshness if needed, FX provider port/research, live read-only operator, CI/boundaries and review fixes.

One serialized operator performs all external reads. Fresh read-only Spec/correctness and Standards/security reviews are required.

## Out of scope

Do not implement:
- production quote signer;
- Ed25519 key storage/rotation;
- Function key/config reconciliation;
- whole-quote v2 adoption;
- publication projection or Shopify publication mutation;
- automatic FX-provider account/credentials;
- Admin/Partner mutations;
- App Events usage submission;
- pricing-plan changes;
- Markets configuration;
- checkout/cart;
- visualizer/admin UI;
- artwork/R2.

## Acceptance

M4-001 is principal-reviewable when:

1. production adapter proves real variant ownership and exact contextual garment base pricing;
2. live read-only contextualPricing shape is captured on the designated Public-app dev store;
3. Partner activeSubscription client and normalization are implemented;
4. live read-only current subscription is captured without mutation;
5. trial/scheduled-cancellation/pending-update behavior is explicit and tested;
6. trial usage suppression matches the locked Insignia billing rule;
7. automatic customization FX is an explicit provider port with current provider research, not a contextual-price-derived rate;
8. missing/stale/unknown provider authority fails closed;
9. all prior M1–M3 checks remain green;
10. fresh reviews have no unresolved material issue.

This does **not** accept M4 overall.

## Stop conditions

Return for principal direction if current Shopify schema materially differs, required live read needs a new scope, live billing contract contradicts retained M0-012 evidence, trial/cancellation semantics remain materially ambiguous, automatic FX forces an immediate account decision, or implementation pressure would require v2 adoption.

Ordinary implementation/test/review fixes remain in scope.

## Handoff

Return one integrated PR with exact refs, pinned Shopify API versions, catalog/context adapter, live read-only context evidence, activeSubscription schemas/evidence, entitlement fixtures, freshness behavior, FX provider research/recommendation, exact external-read register/counts, final-head CI and reviewer dispositions.

Stop for principal review.

No merge, signer/protocol adoption, later M4 slice, M5, gate pass or launch is authorized.
