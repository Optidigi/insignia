# Insignia — greenfield architecture and implementation plan

**Record version:** 1.7 — 15 October 2026 (owner-approved Lean V1 prospective amendment; unaffected contracts and historical evidence retained)

**Status:** [Approved Lean V1](../delivery/authority/lean-v1-2026-10-15.md) governs current shipping work. Option A and unchanged v2/security/history contracts remain. This amendment is not implementation, native acceptance or a gate PASS. The [16 October first-version direction](decision-ledger.md#owner-first-version-direction--16-october-2026) supersedes earlier development-version compatibility requirements: ship only Lean V1 and remove compatibility-only paths/tests; preserve actual immutable records, current purchase/preview integrity and safe cleanup.

**Authority:** The [15 October Lean V1 owner decision](../delivery/authority/lean-v1-2026-10-15.md) supersedes conflicting earlier pricing/scope/billing/acceptance requirements prospectively. Unaffected authority includes the user's pasted baseline, subsequent answers, final inactive-subscription/downgrade approval, [Option A approval](OPTION-A-APPROVED.md), [whole-quote v2 adoption](WHOLE-QUOTE-V2-ADOPTED.md), and the [single-plan owner decision](../delivery/authority/commercial-single-plan-2026-10-10.md). The exact pre-Lean v1.6 plan/ledger remain available at `0c3672e2f38a7c6421f9b4791a3830c2db5aaaf8`; dated decisions and receipts keep their original meaning. No missing `plan.md` dependency remains.

**Delivery:** Consult the maintained [delivery state](../delivery/state.md) for current authorization, evidence and gate status. The v1.3 record remains available at fixed PR #25 merge `4209bb16a09cff95d5cbbc1bbcb082e8c1fa8899` with plan SHA-256 `b730c0dc274af8180a9aae3290189a8fd61b6b92e06681d345fe5d9aab22c06d` and ledger SHA-256 `d4297182b12978822dae124a040a0d47aafcdb7749f7ad8602f0626e964937e9`. The original v1.1 record remains at fixed PR #10 merge `0f2c80a316228bd69fdd2ff272e967ff14647b2b`; approved v1.2 remains at fixed PR #17 merge `662a78cd27507d8a2f1eaa976f1c644c93edd1be`.

**Execution governance:** The [13 October autonomous-delivery direction](../delivery/authority/autonomous-delivery-2026-10-13.md) and [operating model](../delivery/operating-model.md) govern implementation ownership, TDD, proportionate review/CI, substantive sequencing and engineering-versus-native acceptance. This complete technical plan retains unaffected product/stack/protocol contracts. Existing external resource grants remain scoped; engineering delivery does not certify native acceptance or rollout.

This document is intended to be sufficient context for implementation agents. A numbered source register follows section 17. `[S#]` references support external platform/library facts. Requirements and algorithms stated as Insignia decisions are design specifications, not claims of already-observed Shopify behavior.

## 0. Scope, evidence and completion rules

### 0.1 Product scope

Insignia is a public Shopify app for merchant-configured product customization. Buyers select decoration methods, placements, decoration sizes/steps, artwork or merchant-enabled logo-later, and quantities across compatible Shopify garment variants. Preserve the existing storefront UI/visual experience, adapting labels and review interactions where new pricing semantics require it. Rewrite everything else against this record; legacy admin screens, RFQ workflows, production management, fee products, variant pools, schemas and operational machinery are not inherited requirements.

There is **no migration/import work** in development: no importer, dual writes, compatibility views, old-ID mapping, legacy adapters, or migration milestones. Ordinary migrations of the *new application's own schema* are required and unrelated to importing legacy data.

Lean V1 supports ordinary non-Plus merchants through same-real-variant lineExpand and Online Store one-time ordinary cart → checkout. Separate Plus/lineUpdate, product-page express/Buy-now and broad third-party transform compatibility are deferred/not shipping; unsupported routes must not bypass required-product or economic enforcement. It does not offer negotiated Shopify B2B pricing, POS/headless integrations, subscription customization, an RFQ mode, or order-edit repricing. Shopify owns payments, fulfillment, cancellations, refunds, returns and inventory.

### 0.2 Evidence classification

- **Verified fact:** Current primary sources document a capability or constraint; cited below. This is not proof of Insignia's end-to-end behavior.
- **Evidence-backed inference:** The selected combination appears compatible, but an integration test remains necessary.
- **Product decision:** Approved in the conversation and summarized in section 17.
- **Development hypothesis:** A candidate implementation that must pass an explicit gate before dependent work proceeds.

Lean V1 is an approved prospective amendment to the closed baseline, including the unchanged Option A residual boundary. Section 14 narrows applicable gate criteria and closes work through five outcomes; deferred capabilities are not PASS or launch prerequisites. Reuse unchanged evidence and qualify changed boundaries. Algorithms/resource budgets remain reviewable engineering choices; actual expiry, independent authority and historical records do not. Report genuine product/security conflicts directly with evidence and alternatives.

### 0.3 Source reconciliation

Current Cart Transform documentation permits one Function per app per store; do not implement onboarding around the old store-wide one-transform assumption. Retain collision testing. The same-variant one-child approach is still only a development hypothesis. [S1]

Current App Pricing uses Partner API subscription state and App Events. Do not port older Admin Billing API webhook assumptions or copy an `unstable` example when the versioned App Events reference supplies a supported stable endpoint. [S5–S8]

Polaris now has versioned CDN releases; the old blanket assumption that it cannot be pinned is outdated. Pin the tested runtime and align its types. [S14]

The Shopify Rust SDK's Decimal scalar is a wrapper over `f64`. An API type named Decimal is not an exact-money guarantee; inspect the pinned SDK and implement exact adapter conversion/serialization. [S25]

The legacy storefront modal spec is a visual/interaction reference only. Its old single-method pricing and fee-pool calls must not become rewrite contracts. [S24]

## 1. System architecture

### 1.1 Runtime surfaces

| Surface | Implementation | Responsibility |
|---|---|---|
| Embedded merchant app and HTTP API | Astro 7, standalone Node SSR, Preact islands, Polaris Web Components | Authenticated admin pages, commands, App Proxy endpoints, webhook ingress, health endpoints |
| Worker | Node.js 24 LTS, pg-boss | Durable asynchronous work, reconciliation, cleanup, isolated artwork inspection coordination |
| Buyer interface | Theme App Extension, lazy Vite-built Preact bundle, Custom Element + Shadow DOM | Storefront UI, local state, uploads, cart review and cart application |
| Price materialization | Rust Cart Transform Function | Verify authorizations and apply approved real-variant prices |
| Checkout protection | Separate Rust Cart & Checkout Validation Function | Independently verify authorization completeness, context, quantity and actual economic result |
| Data/object services | PostgreSQL 18; private R2 | Durable records, outbox/inbox, original artwork and safe derivatives |

Astro provides Node SSR and Preact integrations; Node 24 is an LTS release. These are platform capabilities, not an executed Insignia compatibility test. [S12, S13, S26]

### 1.2 Dependencies — arrows mean “imports/depends on”

```text
apps/web (server) ──┬──> application ──> domain
                   ├──> database ─────> application ports + domain
                   ├──> shopify ──────> application ports + domain
                   ├──> artwork ──────> application ports + domain
                   ├──> cart-authorization (server)
                   └──> observability

apps/worker ─────── same server composition, plus pg-boss runtime

apps/web (browser islands) ──┬──> contracts/browser
                            └──> visualizer ──> domain/geometry
apps/storefront ───────────── same browser-safe dependencies

crates/cart-transform ──> crates/cart-authorization
crates/cart-validation ─> crates/cart-authorization
```

Domain contains pure TypeScript types, rules, deterministic geometry and pricing. It does not import Shopify, Astro, Preact, Konva, SQL, clocks, randomness, network clients or filesystem APIs. Application owns use cases and the ports they need. Adapters implement ports; database, artwork and Shopify adapters do not call each other. The composition roots coordinate them through application use cases.

Visualizer may depend on the pure geometry export, but domain never imports the visualizer. Konva lives only in the renderer package and is not a state authority. Avoid an all-purpose `shared` package, service locator, generic event bus or configurable workflow engine.

### 1.3 Data ownership and trust boundaries

| Information | Authority |
|---|---|
| Products, variants, availability, contextual garment prices, tax treatment | Shopify |
| Product customization rules, immutable revisions, artwork, accepted quotes | Insignia PostgreSQL |
| Realized cart prices and checkout outcome | Shopify, constrained by Insignia Functions |
| Signing private keys | Insignia encrypted server-side storage only |
| Verification public keys and product-required policy projections | App-owned Shopify metafields/configuration |
| Plan subscription contract and invoice amounts | Shopify App Pricing |
| Recurring entitlement projection; retained historical financial facts | Insignia, reconciled against authoritative Shopify subscription state; no new Lean usage staging/dispatch |
| UI state and cart payloads | Untrusted browser proposals |

Admin authentication is separate from authorization to perform a merchant action. App Proxy proves the signed shop/query context, not ownership of a buyer's artwork or an arbitrary request body. Use scoped guest capabilities and tenant checks. [S9]

Neither an unsigned hidden line property nor a Cart Transform marker is proof of a paid customization. Only a verified authorization bound to observed merchandise/context/quantity/price may create a production purchase binding.

### 1.4 Main flows

**Configure:** authenticate merchant → edit draft → validate domain/entitlements → record immutable requested revision and publication operation → reconcile Shopify policy → activate only after the applicable readiness contract is satisfied. New quote issuance uses the effective activated revision, not a requested or merely acknowledged write.

**Buy:** Theme App Extension → load public configuration through App Proxy → establish guest capability → upload/inspect artwork → build desired *complete customized-cart subset* → backend quote proposal → buyer accepts → immutable quote + signed authorization set → browser applies real variant lines → independent Shopify validation → checkout.

**Purchase:** verified order webhook → durable inbox → reconcile actual Shopify order → bind complete authorization set → immutable purchase facts and erasable design payload → artwork state → immutable first-paid/payment facts; no Lean V1 usage charge.

**Renew:** expired authorization → first enforce current Lean scope and entitlement, then compare production specification, full quantity vector, context and economics. Compatible unchanged values permit a new set; incompatible advanced configuration or material change requires a new Lean proposal and buyer review. Existing valid old offers retain original terms/expiry.

## 2. Repository shape

```text
apps/
  web/                         # Astro standalone SSR and composition root
    src/pages/admin/           # File-based merchant pages
    src/pages/api/admin/v1/    # Authenticated command/query endpoints
    src/pages/proxy/v1/        # App Proxy upstream routes
    src/pages/webhooks/        # Raw-body ingress
    src/islands/               # Preact only where interaction warrants it
    src/composition/
  worker/                      # Job registry, outbox dispatcher, composition
  storefront/                  # Vite + Preact, custom element, theme/cart bridge
packages/
  domain/                      # Config, pricing, money, identity, geometry, purchase rules
  application/                 # Use cases, ports, transactions, authorization policy
  contracts/                   # Zod 4 request/response schemas; browser-safe DTOs
  database/                    # pg/Kysely repositories, inbox/outbox, migrations
  shopify/                     # SDK boundary, auth, Admin/Partner/App Events clients
  artwork/                     # R2, upload inspection and derivative adapters
  visualizer/                  # Renderer-neutral API, direct Konva implementation
  cart-authorization/          # TS binary codec, server signer, fixtures helpers
  observability/               # Pino config, prom-client registry, correlation
extensions/
  insignia-theme/              # Product app block + lightweight cart-repair app embed
  insignia-cart-transform/     # TOML, input GraphQL, schema, build path
  insignia-cart-validation/    # TOML, input GraphQL, schema, build path
crates/
  cart-authorization/          # Shared Rust wire decoder/verification/checked arithmetic
  cart-transform/              # Target-specific normalization and operations
  cart-validation/             # Target-specific normalization and validation errors
fixtures/
  authorization/              # Shared TS/Rust bytes, keys, negative cases
  pricing/
  shopify/                     # Redacted real Function/cart/order captures
  storefront-reference/       # Screenshots and interaction records; no buyer artwork
spikes/
  platform/                   # G1–G6; later replace fixtures/stubs with production adapters
  embedded-admin/             # G7
  billing/                    # G8
  evidence/                   # Gate results, versions, steps, captures, failure reports
scripts/                       # Build extensions, dependency checks, contract validation
architecture/
  implementation-plan.md
  decision-ledger.md
  protocol-v1.md
  api-contracts.md
  feature-entitlements.json   # Commercial values set separately before release
pnpm-workspace.yaml
pnpm-lock.yaml
Cargo.toml
Cargo.lock
rust-toolchain.toml
shopify.app.toml
```

Use explicit package exports. Client bundling must reject server exports of database, Shopify, artwork, signer and observability. Only `packages/shopify` imports `@shopify/shopify-api`; official Rust Function SDK dependencies belong inside Rust Functions. Framework-specific component types remain outside domain/contracts.

`packages/database/migrations` is the single source for application SQL migrations via dbmate. Do not also run a Kysely migration system. pg-boss owns its separate schema/version procedure. [S19, S20]

Pin exact tested package versions in lockfiles, a Node 24 patch, pnpm and Rust toolchain; pin Actions by commit. Initial library installation must pass the full build/type/test matrix. No floating `latest` in runtime deployment configuration. Zod 4 is boundary validation, not a reason to expose mutable ORM-shaped objects. [S27]

## 3. Domain model and invariants

### 3.1 Configuration and publication

**ProductConfig:** stable tenant-scoped identity attached to exactly one Shopify product. Owns one mutable draft and one current published-revision pointer. A unique `(shop_id, product_id)` constraint enforces the rule. Copying creates independent config identity and draft; no synchronized cross-product configuration relation.

**ProductConfigDraft:** schema-versioned editable JSON, optimistic `draft_version`, edit timestamp/actor. Stable IDs identify views, placements, methods and steps; array index is never a long-lived business identifier.

**ProductConfigRevision:** immutable schema-versioned publication with content hash, resolved pricing, production geometry, image revisions, allowed method/placement combinations, required/optional policy, logo-later permission, feature requirements and publication metadata. New Lean revisions freeze the complete final method × placement × size price table. Historical revisions retain their resolved defaults/overrides. Editing a method catalog entry must not mutate an existing revision indirectly.

**DecorationMethod:** stable merchant-defined label plus optional storefront labels and allowed artwork constraints. New Lean prices come from the final product price table. One method per selected placement in v1. Several selected placements may use different methods when the revision permits it.

**Placement/View/Step:** a placement belongs to a product view; a step is a merchant-defined decoration-size choice with scale/dimensions and prices. Garment S/M/L variants are not decoration steps. Support default images, variant/color image overrides, shared geometry and explicit variant overrides needed for the storefront.

Publication validates IDs, references, geometry, complete step schedules, currency codes, pricing scope, feature entitlements and asset readiness. Missing *optional preview* does not prohibit publishing or purchasing. Missing production-critical rule/selection validity does.

Option A trusts correctly published, access-controlled app-owned Shopify policy under its [approved fault boundary](OPTION-A-APPROVED.md). Merchant intent, a durable operation journal, Shopify mutation acknowledgement, exact Admin readback, Function observations and application activation are distinct states. An incomplete or ambiguous publication remains pending/error; it is not the effective policy. Preserve the previous effective policy, known management evidence and already accepted quote terms while resolving a transition. Production activation still requires a reviewed consistency/availability contract; a local model cannot prove platform-wide propagation.

Availability-hold implementation is now governed by the [M5-017 v3 contract](../delivery/prompts/M5-017-AVAILABILITY-HOLD-V3.md) and [PR47 adjudication](../delivery/PR-047-principal-review.md). New FIRST_PUBLICATION/MODE_CHANGE uses effective-anchor v3; SAME_MODE remains no-hold. Preserve v1/v2 historical semantics/recovery and fail closed on unresolved historical state. Durable one-use acquisition/restoration/conditional-compensation claims precede provider dispatch; immutable versioned receipts fence replay. A settled semantic restore mismatch may rehold DRAFT once and becomes OPERATOR_HOLD. Ambiguous writes remain pending/operator-handled. No complete configured-intent discovery or hidden future-intent guarantee is claimed. This does not pass development gates or authorize production activation.

### 3.2 Geometry

Store normalized image-space rectangle center and maximum width/height, not Konva nodes or viewport pixels. Values must be finite and within the image; a rectangle's extents must fit, not merely its center. Reject invalid geometry at write boundaries rather than silently clamping persisted data.

A selected step uses contain-fit scaling inside the placement rectangle. Resolve its geometry per view/variant, then apply the buyer's artwork aspect ratio. Preserve optional physical calibration when used to show decoration dimensions, but do not claim manufacturing precision from an uncalibrated preview. The renderer must distinguish missing image, missing geometry and valid empty placement states.

### 3.3 Artwork

**ArtworkAsset / ArtworkRevision:** original private bytes, verified type/hash/size, safe derivative keys, inspection version, creation/collection timestamps and immutable revision identity. Upload state (`UPLOADING`, `INSPECTING`, `USABLE`, `REJECTED`, `DELETED`) is a technical lifecycle, separate from purchased customization readiness.

**ArtworkSelection:** either a verified revision ID or an explicit logo-later intent. Default artwork can be overridden per placement. Merchant placeholders are display assets, never production originals. Merchant-authored replacement artwork creates a new revision and an audited attachment record.

### 3.4 Customization identity

**CustomizationGroup:** one product, one revision, one production specification, plus a map of compatible variant quantities. The specification includes selected placement IDs, method per placement, selected step IDs, and artwork revision/intent per placement. Compatible colors/sizes share the design; new Lean configurations contain no setup charge.

The canonical identity excludes quantity but includes everything that changes the production design. Resolve defaults, sort maps by stable IDs and hash canonical structured bytes/JSON with a fixed version; do not rely on incidental property order. A different image *chosen by the merchant for the same configured variant* does not by itself mean a different buyer design; its revision is nevertheless recorded for previews.

Exactly recognized identical groups in the same cart may aggregate. Separate unknown logo-later designs must not auto-merge: give each independent deferred-design intent a nonce. Reusing an existing group explicitly preserves that intent. Historical setup semantics remain only for old accepted records; Lean identity does not introduce a setup fee.

**GarmentQuantityVector:** variant IDs with positive integer quantities; zero removes the variant. Shopify product membership and availability are verified by the adapter. Total physical quantity counts each garment once, regardless of placements or price-allocation buckets.

### 3.5 Money and pricing records

**Money:** `{ currency, minor: bigint }`, paired with a versioned currency exponent table. Operations require matching currency. Never use floating point for pricing, signatures or sum equality. JSON DTOs represent integer amounts as decimal strings; PostgreSQL uses checked `bigint` for bounded minor amounts and decimal strings/NUMERIC for FX evidence. Shopify numeric IDs are never JS Number values.

**PricingRule:** new Lean authoring/publication/issuance permits one final nonnegative shop-currency unit surcharge per allowed method × placement × decoration-size choice. Missing is unavailable; explicit zero is a real price. Advanced rule roles/schedules/overrides remain historical reader/engine structures, not new-offer eligibility. Validate constrained inputs and overflow at backend boundaries as well as the editor.

**QuoteProposal:** immutable short-lived review output with desired group vector, config versions, contextual price evidence, FX snapshot, pricing-engine version, totals and proposal hash. It is not yet authorization to purchase.

**AcceptedQuote:** immutable buyer-accepted *complete customized subset of one cart context*. Ordinary cart lines are outside it. Holds economic details, physical group vector and exact materialization buckets. Acceptances may be superseded as the active cart choice without revoking historical offers.

**QuoteLine:** one materialized price bucket for one real variant of one group. Historical allocation may retain two buckets for one variant; Lean issuance has no setup allocation. Line index is quote-global. Do not charge setup again for the split.

**AuthorizationSet:** a distinct signed issue/renewal of one accepted quote with its own ID, numeric u16 key ID, expiry, epoch and protocol version. A v2 set contains one shared envelope and one member carrier per physical QuoteLine. One cart cannot combine authorizations from different sets.

### 3.6 Purchased customizations

**PurchasedCustomizationSnapshot:** accepted production and economic facts bound to one Shopify order and its actual real-variant line representations. Record historical images, geometry, artwork revision references and prices—not pointers to current config. The same reusable authorization may produce multiple order snapshots.

Keep immutable non-identifying economic facts separate from erasable design/artwork payloads. Immutability does not mean retaining identifying artwork forever. Retention removes payloads/objects with an explicit tombstone; it does not alter historical quantities/amounts or manufacture a new missing-artwork production request.

Customization readiness is `PENDING_ARTWORK → READY → ARTWORK_LOCKED`. READY requires all necessary selected placements to have usable artwork. Lock freezes the chosen production attachment set. V1 has no buyer post-order upload, no parallel fulfillment state machine and no unrestricted unlock endpoint. Replacements before locking are append-only; pending originals remain historically visible until retention removes them.

## 4. Pricing engine

**Current Lean profile:** reuse the existing exact-money engine with constrained authoring and backend issuance/renewal validation. For group g and variant v, `total = Σ(g,v) quantity[g,v] × (ShopifyBase[g,v] + Σ(selected placements p) finalDecorationPrice[g,p])`. Each garment contributes its actual contextual base once and each selected placement surcharge once. A missing table entry is unavailable; explicit zero is allowed. No setup, quantity tiers, signed adjustments, layered scopes/inheritance, FX or currency overrides enter new Lean offers. Ten garments at €20 base plus €3 front and €6 back total €290 before Shopify-owned discounts/tax/shipping.

Use one currency equal to shop currency and its qualified primary Market; EUR/USD/GBP are targets, each qualified before enablement/advertising. Unsupported currency/Market contexts fail clearly with safe cart repair and ordinary unrelated lines preserved. Actual country/Market and contextual prices remain independently checked; same currency alone is insufficient. Merchant-wide settings remain untouched.

**Historical engine reference (§§4.1–4.6):** the advanced algorithms/examples below retain meaning for historical readers and valid accepted offers. They are deferred/not shipping for new Lean configurations, not instructions to finish their former launch matrix. Preserve original terms/expiry and stored economics; new issuance/renewal is Lean-fenced. Any incompatible conversion creates an explicit draft/revision and reviewed buyer proposal. Do not replace the engine or rewrite golden fixtures to simulate acceptance.

### 4.1 Historical Inputs and evaluation order

Pure input includes all desired customization groups, resolved published revisions, current contextual Shopify garment prices, target country/market/currency context, FX/override evidence and a versioned rounding policy. Application resolves external data before calling pure pricing.

1. Normalize group identity; aggregate only recognized identical groups.
2. Validate variant ownership, methods, steps, artwork readiness/logo-later and compatible variant selections.
3. Calculate `Q = sum(all customized physical variant quantities)` across every group/product. Ordinary Shopify items contribute zero.
4. For each configured unit component, select the greatest `minQuantity <= Q`. This is **all-units** pricing, not graduated pricing. The selected component price applies to every applicable unit. Different components may have different schedules but use the same Q.
5. Resolve each amount's explicit presentment-currency override, otherwise convert shop-currency amount with the captured FX rate.
6. Round each resolved component unit amount to presentment minor units using round-half-even, then add unit components and the contextual garment price. Apply each applicable setup amount once and round once.
7. Allocate setup amounts deterministically across physical units as below.
8. Construct quote-global materialization buckets, full breakdown and exact totals; verify invariants before accepting.

Required Shopify price lookup failure means no quote. Never substitute zero, default shop pricing, browser-supplied price, or an old cached market merely to complete a quote.

### 4.2 Historical Explicit pricing scopes

| Component | Setup multiplicity within group | Unit multiplicity |
|---|---|---|
| General | Once if configured | No general unit component required by this baseline |
| Method | Once per distinct selected method | Merchant-configured once per garment using that method, OR per placement decorated using that method |
| Placement | Once per selected placement | Per garment decorated at that placement |
| Decoration step | Once per selected placement-and-step | Per garment using that selected placement-and-step |

Method-specific placement/step overrides resolve by replacement, including an explicit zero. Absence means inherit. Resolved method + placement + step components remain additive; an override replaces only its corresponding component, not unrelated pricing levels.

For each setup component, use a deterministic applicability key such as `(ruleId, groupId, methodId?)` or `(ruleId, groupId, placementId, stepId?)` to prevent duplicate evaluation from colors/sizes. Merchant-configured component amounts do not multiply by garment quantity. Under the historical advanced profile, setup fees were not tiered; all-units pricing applied to customization **unit** components.

### 4.3 Historical Formula

For group g, variant v and selected placements p:

```text
Q = Σg Σv q[g,v]
methodUnits[g] = sum distinct-method rates or per-placement method rates,
                 as configured for each method
customizationUnit[g,v] = methodUnits[g]
                        + Σp placementRate[g,p,Q]
                        + Σp stepRate[g,p,Q]
unitBeforeSetup[g,v] = contextualGarment[g,v] + customizationUnit[g,v]
setup[g] = generalSetup[g]
           + Σdistinct methods methodSetup[g,m]
           + Σselected placements placementSetup[g,p]
           + Σselected placement/step pairs stepSetup[g,p,s]
total[g] = Σv q[g,v] × unitBeforeSetup[g,v] + setup[g]
quoteTotal = Σg total[g]
```

Never add Shopify discounts to this engine. The accepted price is customized **pre-discount merchandise**, not total checkout payment. Shipping, Shopify discounts, duties and tax adjustments remain Shopify-owned. The normal variant tax treatment applies to the entire customized price. Inclusive/exclusive-tax context and Function cost interpretation must pass G4.

### 4.4 Historical FX and contextual pricing

The Shopify adapter retrieves contextual market pricing and verifies currency, country and variant applicability. No negotiated company-location/B2B pricing in v1. The contextual pricing API is a relevant surface; exact query inputs belong in adapter contracts. [S11]

Historical FX was designed as an application port; selecting/implementing a new FX provider is deferred outside Lean V1. Require positive rate, supported currency pair, as-of timestamp, provider/source ID, rate version and maximum accepted staleness. Store the original decimal rate and rounding policy. An override wins only for the exact configured component/tier/currency; other components may convert normally. Fail quoting when required FX is unavailable/too stale.

Accepted quotes freeze resolved presentment values. Functions receive the final presentment amount; they must **not convert it again**. Their documented fixed unit prices use presentment currency. [S1]

Renewal can use current evidence to establish unchanged economics without overwriting the quote's original evidence. A changed output amount, material production specification, quantity or market requires a new quote/review. A refreshed FX rate alone does not mutate an existing valid authorization.

### 4.5 Historical Deterministic setup allocation

Use equal-per-physical-unit allocation within the group, not value-weighted allocation. Given total setup minor units S and physical quantity N:

```text
baseSetupPerUnit = S div N
extraUnitCount = S mod N
```

Order logical variants by stable external-ID byte/numeric order defined in the adapter contract, then by deterministic unit ordinal within variant. The first `extraUnitCount` units receive one extra minor unit. All others receive `baseSetupPerUnit`. Implement with ranges, not an in-memory object per garment. Coalesce identical allocations for each `(group, variant, authorized unit price)` into one bucket. At most two setup-allocation price buckets per logical variant before any additional Shopify capacity partitioning.

Keep the per-rule setup breakdown at group level. Allocate the aggregate setup once: independently distributing each rule's remainder can change the final per-unit allocation. Any optional per-unit rule breakdown must fit the already-fixed bucket allocations, not recalculate them. The group setup sum and all quote-line totals must match exactly. A capacity split cannot change fees, identity or tier counts.

### 4.6 Historical Worked examples

**A — Setup across colors/sizes.** Ten red/small plus fifteen black/large share one design, product and revision. Both variants have €20 garment + €3 customization per unit. Applicable setup total is €35. Total is `25 × €23 + €35 = €610`. Setup allocation is €1.40 per garment, so both authorized unit prices are €24.40. Ten thousand identical-spec garments still incur €35 setup, not €35 per variant or garment.

**B — Order-wide 500 tier.** Shirts: 250 at €20 base, customization €3 at Q=500, €35 setup. Hoodies: 250 at €30 base, customization €5 at Q=500, €50 setup. Total is `(250 × €23 + €35) + (250 × €35 + €50) = €14,585`. Ordinary items do not count toward Q. Removing the hoodies creates a new quote for Q=250; all remaining applicable rates are reevaluated. The two original groups do not share setup.

**C — Non-divisible setup.** Three garments at €30 before setup plus €1 setup total €91. Two units at €30.33 plus one at €30.34 preserve the exact total. Shopify must retain the same real variant at these two authorized prices. G5 proves that lifecycle.

**D — Merchant unit scope.** One method at €2/unit with €20 setup, 100 garments, front and back: per-garment mode yields €220 in method charges; per-placement mode yields €420. Other configured components add independently.

**E — Conversion/override.** Garment contextual USD price $22.50. Shop-currency customization €3.00 with captured EUR→USD 1.10 resolves $3.30. Explicit USD setup override $21.00 replaces converted €20 setup. For four units: `4 × $25.80 + $21 = $124.20`; authorized unit price $31.05. A later FX change does not change this offer.

**F — Discounts.** €20 contextual garment + €10 customization, no additional setup, produces €30 pre-discount merchandise. A Shopify 10% discount yields €27 before any other Shopify-owned checkout adjustments. Validator compares the pre-discount materialized amount, not €27 against the €30 authorization.

## 5. Signed cart authorization protocol

### 5.1 Scope and status

The historical per-line v1 proposal below is retained for decision provenance only. [Whole-quote v2](WHOLE-QUOTE-V2-ADOPTED.md) is the adopted production implementation contract; there is no per-line runtime fallback. Tokens are signed, not encrypted: “opaque” means the buyer UI treats them as opaque, not that the claims are secret. No artwork, buyer PII, price rules, JSON or JWT in cart authorization.

Use Ed25519, installation-scoped keys, and one shared v2 envelope plus a member carrier per physical line. Store private keys encrypted using authenticated encryption and a wrapping-key version held outside PostgreSQL. Use the Node crypto signer and maintained Rust Ed25519 verifier with strict verification; never implement curve arithmetic manually. Both Functions verify complete sets independently.

### 5.2 Historical v1 candidate binary layout

All integers are unsigned, fixed width, big-endian. Currency exponent is explicit and checked against the supported versioned table. UUIDs are raw 16 bytes, not strings. Shopify GID suffixes are checked u64 values in the adapter only.

| Offset | Bytes | Field |
|---:|---:|---|
| 0 | 4 | Magic `ISG1` |
| 4 | 1 | Protocol version = 1 |
| 5 | 1 | Reserved flags = 0 |
| 6 | 2 | Key ID |
| 8 | 16 | Installation generation UUID |
| 24 | 4 | Authorization epoch |
| 28 | 16 | Accepted quote UUID |
| 44 | 16 | Authorization-set UUID |
| 60 | 2 | Quote-global line index, zero-based |
| 62 | 2 | Quote-global line count |
| 64 | 8 | Real variant numeric ID |
| 72 | 4 | Authorized physical quantity for this bucket |
| 76 | 8 | Authorized pre-discount unit price, minor units |
| 84 | 3 | Uppercase currency ASCII |
| 87 | 1 | Currency exponent |
| 88 | 2 | Uppercase country ASCII |
| 90 | 8 | Market numeric ID, zero only for an explicitly supported no-market context |
| 98 | 4 | Valid-through local date, day ordinal from 1970-01-01 |
| 102 | 4 | Total customized physical quantity for the entire quote |
| 106 | 8 | Entire quote pre-discount total, minor units |
| 114 | 64 | Ed25519 signature |

Total: **178 bytes**, **238 characters** when unpadded base64url encoded. G3 must prove transport of that value through Ajax cart properties, expanded child properties, checkout and order APIs; do not infer a platform allowance from this size alone.

Signature message: fixed domain-separation prefix `Insignia\0CartAuthorization\0v1\0` followed by the 114-byte payload. Use distinct prefixes for any later protocol. Encoding rejects unknown fields/flags, padding, alternate encodings, trailing bytes and overflow. External money is bounded to the intersection of DB, protocol and tested Shopify limits.

Use one reserved property `_insignia_auth` for the token. Additional human-readable summary properties are informative only and must not override quote IDs or production specifications. Do not put production original URLs in cart properties.

### 5.3 Whole-set verification

Normalize actual physical priced items through the target-specific adapter; G1/G6 determine which parent/component records represent them. Do not guess by double-counting parent and child. Then:

1. Classify plain optional lines versus required/Insignia-marked lines from independent product policy and reserved markers.
2. Decode each bounded token and verify key, signature, installation generation, epoch, local validity date, currency, country and market.
3. Require one quote ID and authorization-set ID across all customized lines; common headers, totals and expiry must agree.
4. Require each index `0..lineCount-1` exactly once; reject duplicates, missing members, extra members and mixed renewals. Platform-induced fragmentation is allowed only if G1 supplies a trustworthy deterministic normalization that reconstructs each bucket exactly.
5. Match real variant and quantity to each signed bucket; prohibit paid customization with a selling plan.
6. Checked-sum physical quantities and `quantity × unitMinor` using sufficiently wide intermediates; compare with signed totals.
7. Validator additionally compares **actual materialized pre-discount economic amounts**, not just signature claims or a transform-generated marker.

For a historical tier-priced offer, a buyer cannot preserve a 500-unit tier by submitting a quote for 500 and checking out only 10: completeness and quantity checks fail. Removing every marker on an optional product creates a plain purchase with no production customization, not an entitlement to free customization. Required products still reject unsigned purchases.

### 5.4 Expiry, replay and renewal

Three shop-local calendar days means issuance on local day D is valid through **D+2 inclusive**, expiring when shop-local date becomes D+3. It is not a rolling 72 hours. Store shop timezone and issuance/expiry evidence in PostgreSQL; Functions use Shopify's shop-local date. A timezone change triggers reconciliation and renewal review, and is included in boundary tests. [S2]

A complete set is a reusable offer during that window, for the same signed vector and context. It may produce multiple separate orders; Lean V1 emits no per-order billing event. Issuing a replacement quote does not individually revoke older valid offers. No per-quote consumed flag is consulted offline.

An expired set can renew automatically only when the full economic/production/context comparison is unchanged, artwork still usable and retained, current plan permits issuance, and both Function configurations are healthy. Renewal gets a new set ID and signatures; the accepted quote is not mutated. Changed values require buyer review/new acceptance.

### 5.5 Key/configuration rollout

Per-shop public configuration includes schema version, installation generation, current epoch, accepted protocol versions, bounded verification keys and key validity windows. A new key is first published to both Function surfaces and read back/verified. Only then can the backend issue with it. Keep old verification keys at least through outstanding valid windows; retain archived public evidence for historical verification after removal from Functions.

Routine publication, renewal, billing loss and plan changes do not bump epoch: doing so would contradict honoring old offers. Bump for emergency revocation or installation-security reset. Installing again creates a new generation and keys; do not revive an old installation's authorizations.

Rotation/epoch changes use a convergence workflow, not a fiction of a transaction across PostgreSQL and Shopify. Stop issuance while projections disagree. A Function mismatch fails closed. Maintain desired/observed hashes and safe overlap windows; never assume Shopify metafield writes are instantly visible to all Function invocations.

### 5.6 Exact decimal boundary

Read price lexical strings and parse to checked integer minor units; emit exact decimal strings. The SDK's `f64` Decimal convenience scalar must not perform the comparison or allocation. Implement small target-local exact scalar access/serialization wrappers using the pinned SDK's supported value/serialization API and validate their outputs against generated GraphQL contracts. This is adapter code, not a fork of Shopify's runtime. G5 must prove it compiles, fits resource limits and preserves values end to end. [S25]

## 6. Shopify integration and billing

### 6.1 Installation and authentication

Use Shopify-managed installation with scopes declared in app configuration. For embedded admin, verify App Bridge identity tokens and use token exchange through the isolated Shopify adapter. Shopify's documented custom-framework flow supports this without importing the React Router application package. [S10]

New public apps require expiring offline access tokens. Store each access/refresh pair encrypted with expirations and token generation; refresh under a per-shop single-flight/lease and persist the replacement atomically before exposing it to callers. Never exchange a new offline token for every request. Classify transient errors versus terminal reauthorization. Use online/user-scoped authorization for staff-sensitive actions where Shopify permission semantics are needed. [S28]

Admin token verification checks algorithm/signature, audience, destination/issuer consistency, expiry and not-before. Resolve tenant from verified claims, not a body `shopId`. Apply per-use-case permissions for publishing, billing management, order artwork and downloads. Don't turn an offline access token into a universal staff-permission bypass.

App Bridge/platform-issued identity tokens and App Events credentials may use JWT as required by Shopify. The no-JWT decision applies specifically to Insignia **cart authorization**.


**Least-privilege scope contract.** The initial adapter requires `write_products` for app-owned product policy metafields (and its implied product read access), `read_orders`, `write_cart_transforms`, `write_validations`, `write_app_proxy`, and `read_markets` for the chosen market-resolution queries. Confirm each exact query/mutation against the pinned schema and remove any permission made unnecessary by its implementation. Request approval for `read_all_orders` before declaring it: default order access covers only orders created in the previous 60 days. The justification is reconciliation of known Insignia purchases, late payment/refund events and ongoing artwork work within retention—not a legacy import or unrestricted historical-data collection. [S31]

Approval is a release prerequisite for the promised older-order reconciliation path. Until granted, retain available purchase snapshots and expose restricted reconciliation explicitly; an authorization failure is not evidence that an order was deleted. Do not request order-write, inventory-write, fulfillment-write, theme-write or subscription-contract scopes merely to operate this design. Extra development-store test permissions do not belong in the public app scope manifest. Protected-customer-data review remains a separate approval requirement. [S23, S31]

### 6.2 Function installation and projections

Create one Insignia Cart Transform and one independent validation using the current handle-based installation APIs. Enable validation explicitly and set both applicable `blockOnFailure` flags. Those settings address runtime failures; they do not prove operation-collision safety. [S3]

Shop/product app-owned projections contain only what Functions need: installation generation, public key registry, epoch, protocol support, and required/optional product policy. No private keys, buyer artwork, detailed rules or quote JSON. Both Functions must read a compatible configuration version. Shopify is not a second quote database. App-controlled publication must preserve recognizable management evidence during an interrupted required-policy transition; a partial or malformed state remains detectable and rejects, rather than becoming optional by default. Option A accepts unexpected joint loss or coherent rollback of all trusted evidence *outside* the supported publication contract as a residual incident, not as normal publisher behavior.

Publication sequencing favors safe denial over transient unsigned required purchases. A mutation acknowledgement and exact Admin readback establish only their respective facts; one sampled Function invocation, repeated Admin reads or a fixed delay do not prove that every future Function input has the new revision. For stricter transitions, account for the previous effective policy and in-flight carts before exposing a product or enabling new quote issuance. If the needed activation/availability precondition is unverified, retain an explicit activation-pending state and the prior effective policy. Any temporary change to product availability is a separate, merchant-facing operation requiring its own reviewed precondition and effect; it is not automatic archival permission. Billing cancellation/downgrade never clears required flags or keys merely to ease checkout.

There is no generic Cart Transform fallback or separate Lean Plus branch. Retain and qualify the non-Plus G1 route: expand to one child with the same real variant, child quantity one relative to its parent, and the authorized fixed unit price. A failed G1 reopens that mechanism instead of enabling fee products behind the scenes.

### 6.3 Function behavior during cart mutations

Cart-wide replacement may require several Ajax operations. Do not demand complete sets during every intermediate cart mutation in a way that makes repair impossible. Candidate G6 policy:

- Cart Transform returns prices only for a valid complete authorization set; invalid sets never receive new authoritative customization prices.
- During ordinary cart interaction, allow removal/replacement of stale or malformed lines. The storefront marks such state as requiring review and does not display a base-price fallback as an accepted customization.
- During checkout interaction and completion, the Validation Function enforces all authorization, required-product and economic checks. Unknown/missing journey context must not accidentally become a checkout bypass.

The current Validation API exposes buyer journey steps; verify their actual behavior on the supported ordinary cart → checkout route, with unsupported-entry bypass rejection. G6 must prove both non-bypassability and recoverability. [S2]

### 6.4 Context and cart integration

Use the Ajax Cart API for the Online Store cart through a theme-side adapter. App Proxy carries Insignia config, proposals, acceptance and upload control requests. The browser's claimed market/cart is a proposal; Shopify Functions independently compare checkout context.

Pin an explicit tested Shopify API version (initial candidate 2026-07) for Admin, Functions and App Events, with separate contracts for APIs whose versioning differs. Check deprecations and generate input/output schemas in CI. Never rely on a `latest` URL at runtime or copy a deprecated field merely because it appeared in an example.

The Shopify adapter provides narrow ports such as:

```ts
interface CatalogPricingPort {
  resolveVariants(input: PricingContextRequest): Promise<ResolvedVariantPrices>;
}
interface FunctionConfigurationPort {
  inspect(shop: ShopRef): Promise<ObservedFunctionConfiguration>;
  applyDesired(input: DesiredFunctionConfiguration): Promise<ApplyResult>;
}
interface OrderReadPort {
  getOrder(ref: ExternalOrderRef): Promise<NormalizedShopifyOrder>;
  changesSince(input: ReconciliationCursor): Promise<OrderChangePage>;
}
```

These are illustrative domain-neutral signatures; concrete DTOs must include timeouts, versions, paging and typed errors, not an untyped `graphql(query)` leaking into application code.

### 6.5 Webhooks and reconciliation

Declare app-wide subscriptions in TOML. Required business topics include orders/create, orders/paid, orders/updated where needed for reconciliation, refunds/create, app/uninstalled and app/scopes_update; subscribe to necessary product/shop changes for configuration validity and timezone/currency changes. Select exact supported topics and scopes from the pinned schema; avoid an indiscriminate all-events subscription.

Uninstall additionally uses a private generation-specific APP_UNINSTALLED subscription destination, enrolled from verified current installation identity. Its exclusive destination plus raw HMAC binds purpose and generation; generic app-wide headers/body do not. Dispatch/unknown outcomes, exact readback, repair, old-generation fencing and separate immutable privacy recovery are required. Generic cleanup accounting is non-authorizing and never qualifies uninstall. See deployment/lifecycle/README.md for runtime limits and required native qualification.

Mandatory privacy topics are customers/data_request, customers/redact and shop/redact. Verify raw request HMAC before parsing/trusting payloads. Acknowledge only after durable receipt. [S21, S22]

Deduplicate delivery on `(installation_id, webhook_delivery_id)` and make business processing idempotent independently. Track event ID/topic/API version/received time. An out-of-order event triggers reconciliation from Shopify rather than rolling back newer facts. Reconciliation paginates all order lines and refunds; never assume the first GraphQL connection page is complete.

The [13 October owner-delegated M8 decision](../delivery/authority/m8-purchase-proof-ownership-2026-10-13.md) permits a distinct signed-offer/original-order matching proof for a qualified Online Store one-time flow. Preserve signature, complete physical members, actual merchandise/economics and historical authorization checks. Admit wholly unavailable actual localization only through trusted creator-origin/current-enforcement qualification; record it as unknown, with quote country/Market identified as authorized context. Independent provider context, when supplied, must still match. Production admission remains disabled until native qualification; no current-health observation becomes historical execution proof. Required-product enforcement and its incident limitations remain separate obligations.

Record orders at creation, bind approved customizations, and maintain first-full-payment facts. Refund processing appends Shopify economic facts without recalculating historical customization pricing; Lean V1 has no per-order app charge. Unsupported merchant order edits are recorded as discrepancies for review, not treated as newly authorized customization changes.

### 6.6 Recurring-only commercial contract

One plan includes all released Lean V1 features: USD $49.99 per 30-day cycle, with an authoritative 14-day trial. There is no usage meter, 100-order allowance, overage or per-order charge. Keep existing technical resource limits and disclose them honestly. The [Lean owner authority](../delivery/authority/lean-v1-2026-10-15.md) supersedes the historical 10 October hybrid target; saved provider drafts/current subscriptions remain actual facts, not automatically converted contracts.

Qualify actual recurring-only provider configuration and its supported billing-management/selection route before enabling it under a scoped effect grant. Adapt current flat-plus-meter entitlement recognition deliberately; switching off dispatch alone does not make that reader compatible. Read authoritative contract/trial/cancellation state through the supported Shopify adapter and keep a versioned feature mapping. Redirect parameters alone grant no entitlement. Server-side publication/new-offer/acceptance/renewal checks enforce supported features and Lean scope; UI hiding is insufficient.

### 6.7 Trial, inactive contract and historical access

The 14-day trial follows authoritative provider timestamps; do not reset it locally on selection, reinstall or restart. Qualify cancellation, stale/unknown state, reauthorization and new-action eligibility. Without a valid active trial/paid entitlement, stop new issuance/renewal while preserving valid old offers through their original expiry and authorized historical purchase/artwork access within retention. Required products never silently become plain purchases.

Old advanced configurations remain readable, but new issuance/renewal requires Lean-compatible inputs. Conversion creates a new draft/revision and buyer-reviewed replacement, not mutation of historical prices. Shopify owns payment, refund and inventory operations.

### 6.8 Historical usage work — deferred, not shipping

Prior M9 ledgers, immutable intent/attempt identities, response classifiers and failed/partial native evidence retain their exact meaning; they are not recurring-only acceptance. Inspect existing financial facts and unresolved operations before transition, reconcile any genuine merchant obligation and preserve retention. New usage staging/dispatch is disabled for Lean flat-plan operation. Trial and flat-plan purchases are never back-billed later. No new meter, sender, allowance or per-event processing subsystem is a Lean launch prerequisite. Archived hybrid provider contracts/tests stay available where historical recovery genuinely depends on them.

## 7. Admin application

Astro owns routing, server authorization and rendering. There is no application-wide React/Preact router. Use Polaris for ordinary controls and page composition, plus Preact islands for the price editor, placement canvas, upload/preview and other genuinely stateful controls. Use direct App Bridge APIs, not React wrappers. Polaris and Preact support framework-independent custom elements, but their events/hydration/focus integration is tested in G7. [S14, S15]

### 7.1 Secure SSR boundary

Never return private merchant data merely because a request includes `shop`/`host` query parameters. Authenticated document requests may SSR their permitted content. A request without valid credentials returns only a minimal public bootstrap/shell; App Bridge obtains an identity token before private requests.

The initial implementation candidate keeps file-based pages and uses authenticated HTML fragments for read-only server-rendered sections, and already-mounted page-local islands fetching authenticated DTOs for interactive sections. The fragment path returns trusted server-generated markup without inline application scripts; it is not a generic client router. Header-authenticated mutations use explicit endpoints. Locally implement and qualify cold-launch/deep-link/reload behavior, including whether a supported platform document-authentication mechanism removes the bootstrap step. Named native G7 browser observations may remain deferred during engineering development/review under the operating model. Do not add custom long-lived browser sessions or a SPA as an untested shortcut.

Set frame-ancestors for Shopify admin and the verified shop, use no-store on private responses, avoid logging URL credentials and enforce same-origin request protections alongside identity tokens. Load App Bridge and exactly one version-matched Polaris build. Initial candidate Polaris 1.1 with aligned type package; upgrades run visual/component regression tests. [S14]

### 7.2 Screens and use cases

**Installation/readiness:** plan status, scope/Function readiness, theme installation link, actionable errors; explicitly report conflict or required-product purchase restrictions.

**Product configuration:** product selection, one config, draft editor, copy-to-product, methods/placements/steps, final nonnegative price table (missing unavailable; explicit zero), shared/variant images, visualizer geometry, optional/required and logo-later switches. Show per-garment placement prices and their exact sum; retain useful imagery/geometry without setup/tier/layer/override controls.

**Publication:** optimistic save with conflict feedback, validate, preview, explicit publish. Return immutable revision and projection-readiness state. A stale editor receives 409, not silent last-write-wins. Copying snapshots editable content into an independent draft; no hidden linked config inheritance.

**Orders/artwork:** customized order overview, per-group historical preview and real-variant quantities, private originals, approved merchant-only post-order attachments, readiness/lock controls and retention expiry indicators. Shopify status is displayed as context, not reproduced as an Insignia fulfillment engine.

**Billing/settings:** verified recurring-only contract/trial dates, all-released-feature and technical-limit disclosure, plus supported billing management. No usage dashboard or multi-plan comparison; labels and server authorization use the same qualified versioned contract.

Do not automatically implement legacy RFQ, notes, CSV, reminder automation, QC or native order-block extensions. They are not scope through legacy inheritance.

## 8. Storefront

### 8.1 Bootstrap and visual reference

Theme App Extension app block supplies the customize trigger and trusted *non-authoritative* product/context hints. A lightweight app embed detects Insignia cart lines and exposes review/repair outside product pages. No direct theme-source editing. Theme extensions provide this installable surface. [S16]

Lazy-load the custom element/Vite bundle and Konva on interaction or when cart repair is necessary. Register once; support multiple product sections and theme-editor section replacement without duplicate handlers. Pass locale-aware Shopify cart root and merchant-configurable proxy prefix explicitly rather than hardcoding storefront paths.

Shadow DOM isolates styles. Explicitly manage dialog focus, focus return, scroll locking, keyboard/escape behavior, live error announcements, touch interaction and composed events. Shadow DOM is not a security boundary. Do not load Polaris into the buyer interface.

Reference interactions: upload/logo-later, method selection, placement selection, per-placement step choice, conditional multi-view preview, review and garment quantity matrix. Preserve slider/card/placement-tab alternatives and graceful missing-preview states from the existing visual reference. Match actual legacy desktop/mobile layout, typography, color, spacing and interaction states. Only approved Lean per-garment price/review wording changes are permitted; cart grouping acceptance does not waive storefront fidelity. [S24]

### 8.2 State model

One Preact reducer/store per customizer instance; no canvas-owned business state. Domain selections, upload status, active view, desired quantities and accepted/proposed quote IDs are distinct. Derive a normalized render scene from state. Konva edits dispatch commands back to the store and are not accepted into pricing until normalized/validated.

Use monotonically increasing request generations and AbortController so stale config/quote/image responses cannot overwrite new selections. State such as “reviewed”, “authorizing” and “applying cart” is explicit. Browser price previews are non-authoritative; the final review is the backend proposal.

Guest capability is an unguessable bearer value, stored hashed server-side and scoped to shop/session/resources. Do not use App Proxy cookies. Avoid persistent browser PII/artwork. Memory/session storage may carry minimal resumable IDs/capabilities with explicit expiry. An authorization token is **not** an artwork-download or post-order-management capability.

### 8.3 HTTP contracts

All following routes are upstream logical paths mapped behind App Proxy; published storefront URLs use the configured proxy mount. API version is explicit. Requests and responses are Zod-validated, size bounded and return a stable error envelope `{code,message,requestId,details?}` with no secret payloads.

| Method/path | Input and result |
|---|---|
| GET `/v1/config` | Product and current selection context → current published revision ID, safe config DTO, image/placement choices and readiness |
| POST `/v1/sessions` | Signed shop context → guest capability and expiry; rate-limited, no cookie reliance |
| POST `/v1/uploads` | Capability, declared metadata, idempotency key → upload ID, quarantine PUT URL, constraints and expiry |
| POST `/v1/uploads/:id/complete` | Capability + upload ID → idempotently queue inspection, return status |
| GET `/v1/uploads/:id` | Owner capability → inspection result and safe derivative reference; never arbitrary object-key access |
| PUT `/v1/designs/:id` | Versioned selection/variant vector → validated draft version; conflict is 409 |
| POST `/v1/quote-proposals` | Complete desired customized subset and context → proposal ID/hash, breakdown, total Q, expiry, changed groups |
| POST `/v1/quote-proposals/:id/accept` | Expected proposal hash, capability and idempotency key → immutable quote, set ID, real-variant bucket vector and tokens |
| POST `/v1/quotes/:id/renew` | Owner capability and current desired/context vector → fresh set, or 409 REVIEW_REQUIRED, or entitlement denial |
| POST `/v1/cart-applications/:id/confirm` | Observed cart vector/fingerprint → UX reconciliation result; never proof of payment |

Admin contracts cover draft get/save/publish/copy, authorized artwork inspection/download/attachment/lock, order queries and plan-state refresh. Commands have tenant/user context derived outside the body. Safe defaults: 400 malformed, 401 invalid capability/auth, 403 entitlement/permission, 409 stale/concurrent/review-needed, 422 domain-invalid, 429 throttled, 503 authoritative dependency unavailable.

### 8.4 Acceptance and cart application

Read the current cart, normalize its Insignia subset, and construct the *desired entire subset*, including the newly configured group. Retained groups remain in the complete acceptance vector; ordinary cart items stay untouched. The server verifies resources and current pricing independently of the browser's amounts.

On acceptance, recheck proposal expiry/hash, current publication pointers, entitlement, material pricing context and artwork status. Persist acceptance and issue metadata transactionally; sign only committed claims. If any relevant input changed, return a new proposal/review requirement. Repeated acceptance with the same idempotency key returns the original result, not another group or charge.

Cart application uses actual current line keys. Update/remove only Insignia lines, then batch-add desired buckets with tokens, preserving ordinary lines. Do not assume Ajax provides a transaction across these steps. Refetch and verify after each mutation sequence; a failure remains visibly “cart needs review,” not “success.” Local/BroadcastChannel locking improves UX across tabs but the Function set checks are the security authority.

For cart quantity/removal edits, fetch a replacement proposal for the full desired subset. Changed quantities/designs still require a complete valid vector; historical tier offers keep their original complete-set constraints. Theme cart changes outside Insignia must still be safe: the validation gate blocks checkout and the app embed supplies repair. Dedicated product-page express/Buy-now integration is deferred; unsupported entry points must reject safely and cannot bypass required customization.

A config may be stale while an accepted offer remains valid. Only unaccepted sessions reload current publication before authoritative pricing. The UI distinguishes unaccepted-config refresh, expired-offer renewal and material reprice/review.

## 9. Shared visualizer

Define a renderer-neutral scene and command boundary. Only the implementation factory imports Konva, lazily on the client. No Konva objects appear in saved config, HTTP DTOs or Preact state. Direct Konva supports this imperative renderer role. [S17]

```ts
interface Visualizer {
  update(scene: RenderScene): void;
  resize(viewport: {width: number; height: number; pixelRatio: number}): void;
  setMode(mode: 'preview' | 'edit-placement'): void;
  destroy(): void;
}
interface VisualizerOptions {
  element: HTMLElement;
  onCommand(command: GeometryCommand): void;
  onStatus(status: RenderStatus): void;
}
```

RenderScene contains a scene version, chosen background image revision, canonical image-space geometry, selected artwork raster references, placeholder specification and selected placement. Asset loading is injected or encapsulated with cancellation and request versions. Preview image access is separated from original download authority.

Compute the image content rectangle after contain-fit/letterboxing; map normalized geometry to **that rectangle**, not the full canvas viewport. Derive logo size from artwork aspect ratio and placement/step constraints. Layers are background, artwork, then editing/selection affordances. Missing assets produce an explicit fallback scene. ResizeObserver and device pixel ratio affect rendering only.

Maintain a stable placement-ID→node map; apply diffed positions/images and batched draws. UI selection immediately projects to canvas; drag changes emit normalized commands back into the owner store. Ignore/replace asynchronous image results for old scene versions. Destroy listeners, observers, stages and transient URLs on unmount.

Server preview generation uses the same pure geometry math with Sharp and safe images. It does not load a browser Konva stage in the worker. Accept known rasterization differences in server preview tests; product layout/placement must match. Original production files, not screenshots, are the merchant deliverable.

## 10. Persistence and transactions

PostgreSQL is the durable application authority. Use pg with Kysely and explicit bigint/NUMERIC conversions; driver defaults are not the domain Money contract. [S18]

### 10.1 Logical schema

All tenant tables include `shop_id`. Composite foreign keys or equivalent enforced joins prevent cross-tenant associations. Avoid a separate schema/database per merchant.

| Table family | Main columns, constraints and ownership |
|---|---|
| `shops`, `installations` | Stable shop identity; generation UUID; install/uninstall timestamps; timezone/currency; active generation pointer. Shopify adapter owns external identifiers. |
| `shop_credentials`, `signing_keys` | Ciphertext, wrapping-key version, refresh expirations/generation; key ID/public key/lifecycle. No plaintext secrets. |
| `function_projections` | Desired/observed config hash, transform/validation IDs, readiness/error, checked time; unique per installation/surface. |
| `product_configs`, `config_drafts` | Unique shop/product; current revision pointer; draft JSONB/schema version and CAS version. |
| `config_revisions` | Config ID/revision number/content hash/schema version/resolved JSONB; no ordinary update permission. Unique config/revision number. |
| `method_catalog`, `merchant_settings` | Mutable merchant defaults; published revisions copy resolved values instead of depending on them live. |
| `preview_assets` | Merchant image/derivative versions, ownership and reference counts; separate from buyer-artwork retention. |
| `buyer_sessions`, `design_drafts` | Hashed capability, expiry, CAS version, minimal selections; no required guest email field. |
| `upload_sessions`, `artwork_revisions` | Quarantine key, declared/verified metadata, inspection state/version, original/derivative keys, collection/expires dates, failure reason, digest. |
| `quote_proposals` | Hash, desired-set/revision references, resolved economics and short expiry; no acceptance mutation of payload. |
| `accepted_quotes`, `quote_groups`, `quote_lines` | Immutable accepted economic payload; group→config revision; physical quantities; bucket ordinal/variant/unit amount; unique quote/index. |
| `authorization_sets`, `authorization_tokens` | Quote ID, generation, epoch/key/protocol/valid-through; immutable signed claims/digest/token bytes as needed for replayable API responses. |
| `cart_applications` | Attempt/idempotency identity, expected/result fingerprint and mutable application state; not economic authority. |
| `purchase_orders`, `purchase_groups`, `purchase_lines` | Unique shop/order; actual Shopify line mappings, authorization set, paid facts; accepted immutable economics and metadata. |
| `purchase_design_payloads`, `artwork_attachments` | Erasable production detail and append-only replacement links; current working attachment pointer and optimistic version; lock events. |
| `refund_facts` | Unique external refund/detail identity, observed amounts/currency/time and purchase links. No fee recomputation. |
| `plan_catalog_versions`, `subscription_observations` | Internal feature contract; external plan/contract/cycle/trial state with observation and effective times. |
| Historical M9 usage/intent/attempt tables | Preserve existing immutable financial history and unresolved-effect fences; no new Lean usage staging or dispatch. |
| `webhook_inbox`, `outbox` | Durable received raw payload with short retention; topic/version/delivery dedup; transactional work intents with retry/lease fields. |
| `reconciliation_cursors`, `idempotency_records` | Tenant/topic watermarks; command key+request hash+result identity; same key/different body is conflict. |
| `deletion_tasks`, `audit_facts` | Erasure progress/tombstones and minimal permitted audit metadata, separate from identifying payload. |

Use JSONB for resolved config/revision and immutable structured quote/design payloads. Normalize identity, money, joins, dedup and operational status fields that need indexed queries. Do not create a table per possible geometry/pricing property.

### 10.2 Important indexes and constraints

Unique `(shop_id, product_id)`, `(config_id, revision_no)`, `(quote_id, line_index)`, `(shop_id, order_id)`, usage business identity, webhook delivery identity and command-idempotency identity. Index `(shop_id, created_at, id)` for paged lists, `(state, available_at)` for outbox work, `(expires_at)` for cleanup, and `(shop_id, artwork_id)` for ownership lookups. Do not GIN-index every JSONB column by default.

Check positive quantities, valid currency/exponent, nonnegative final amounts, bounded IDs/versions, `line_index < line_count`, and coherent state transitions. Use transactions for invariants spanning rows. Accepted payloads are insert-only for ordinary roles; mutable delivery/readiness projections live separately. Privacy erasure uses a constrained deletion path, not an excuse to let application code overwrite economics.

### 10.3 Atomicity and external work

Publish intent: compare draft CAS version → validate → insert immutable requested revision and durable publication operation/outbox record in one transaction. Do not move the effective published pointer before the activation contract is satisfied. Shopify mutation and exact readback occur outside the transaction; an ambiguous response is reconciled by reading the exact desired state before retry or conflict classification. Activation separately advances the effective pointer only under the reviewed preconditions. The M0-008 in-memory journal tests model restart and ordering, not durable database transactions.

Accept: compare proposal/current permitted inputs → insert quote/groups/buckets/set identity → insert idempotency result in one transaction. Generate/persist signatures against committed immutable claims; reissuing after a crash uses the same set identity/claims.

Webhook: verify body → insert durable inbox → acknowledge. Processing reconciles and upserts facts idempotently, inserts downstream outbox intents and marks processing complete transactionally.

Use an explicit PostgreSQL outbox rather than assuming that an arbitrary Kysely transaction and pg-boss send are atomic together. Dispatcher enqueues stable job IDs and marks delivery; a crash may dispatch twice, so consumers still deduplicate by business identity. Do not claim queue delivery equals exactly-once Shopify side effects.

### 10.4 Retention and erasure

Buyer artwork and identifying customization payloads expire no later than six calendar months from original collection; reuse or reference count cannot extend that deadline. Use shorter explicit defaults for transient states: presigned PUT 5 minutes, incomplete uploads 24 hours, abandoned drafts/artwork 7 days unless a shorter security/abuse policy applies. These are configurable implementation budgets, always bounded by the approved maximum.

Do not issue an authorization that can outlive the usable lifetime of required artwork. Near retention expiry, require new usable artwork/review or a deliberate logo-later selection when allowed; never promise production with a file scheduled to disappear mid-offer.

Warn merchants before deletion (initial schedule: 30 and 7 days) and provide authorized export/download. Do not delay deletion because an order is unfinished. Track references through previews, thumbnails, quote/design payloads and log/job payloads; deleting only the original is insufficient. Identifying strings and artwork digests may also be personal data depending on their linkage.

Customer/shop redaction can require earlier deletion. Handle exports and identity lookup using minimal Shopify mappings; do not collect an extra guest email just for deletion. Strip unnecessary webhook PII quickly. Keep only permitted pseudonymized economic/audit records under a separately documented retention basis; no invented universal financial retention period. [S22, S23]

Deletion is idempotent across DB and R2, with tombstones and retryable tasks. Backup restores must reapply erasure tombstones and actual expiry cleanup before public service resumes. The 18 October owner clarification permits encrypted isolated backups for seven days, capped by original collection plus six calendar months and any already-promised cleanup deadline. Preserve original payload deadlines inside the archive and never extend existing receipts. Off-host copies retain the same archive expiry. Restores remain isolated/HOLD until current erasure/expiry replay, object cleanup and authority requalification complete. Merchant config/product mockups are not automatically subject to the buyer-artwork collection rule, but buyer-supplied artwork cannot be reclassified to evade it.

## 11. Worker and job method

pg-boss supplies queue scheduling/retries on PostgreSQL. Its supported Node/PostgreSQL baseline fits the chosen versions; side-effect idempotency remains the application's job. [S20]

| Job | Business idempotency | Initial retry/failure policy |
|---|---|---|
| `process-webhook` | Inbox ID plus downstream fact keys | Transient retries with exponential jitter; missing dependency triggers reconciliation; terminal malformed input is retained as a reviewable failure |
| `reconcile-order` | Shop/order + observed Shopify version/facts | Retry throttling/network errors; paginate fully; incomplete bindings remain explicit exceptions |
| `inspect-artwork` | Asset revision + inspection version | Retry transient storage errors only; format/resource violations are terminal rejection; hard-kill hung child |
| `render-preview` | Immutable scene/asset digest + renderer version | Bounded retries; optional preview failure does not rewrite purchased facts |
| `reconcile-installation` | Installation generation | Recover scopes/credentials/Function drift; obsolete generation is a no-op, not a recreated install |
| `reconcile-function-config` | Surface + desired configuration hash | Safe overlap/retry; suspend issuance until agreement; never clear security policy on error |
| `refresh-shop-token` | Shop + credential generation | Serialized refresh; atomically persist pair; terminal auth response requires merchant reauthorization |
| `reconcile-subscription` | Contract observation/effective version | Refresh at plan redirect and periodically; unknown/stale state blocks new issuance after freshness budget, not historical access |
| Historical usage delivery | Stable preserved financial identity | Deferred/not shipping; no new staging/sends or flat-period back-billing; reconcile any genuine existing obligation |
| Historical usage reconciliation | Existing obligation identity | Run only where a genuine retained obligation requires it; not new Lean billing functionality |
| `retention-warning` | Asset/deadline/notice type | Deduplicate; notice failure does not extend collection cap |
| `delete-expired-data` | Deletion task/resource version | Retry until completed; verify missing objects is success; audit erasure without retaining erased content |

Initial transient policy: exponential backoff with jitter from 5 seconds, cap 15 minutes, up to 12 automated attempts before review; honor provider Retry-After and tighter billing deadlines. These values are tuning defaults, not host-specific alert thresholds. Recurring reconciliation is independent of exhaustion of an individual job. Separate CPU-heavy image concurrency from webhook/billing queues to prevent upload floods starving economic processing.

Jobs carry resource IDs and expected versions, not copies of full artwork, secrets or long-lived customer payloads. Check installation/deletion generation before and after external work. Use worker leases, graceful shutdown and cancellation; a shutdown must not mark unfinished work successful.

## 12. Artwork pipeline

### 12.1 Upload and immutable promotion

1. Verify App Proxy plus guest/merchant resource capability, file declaration, tenant quotas and concurrent upload limit.
2. Allocate random quarantine object key and short-lived presigned PUT. Pin allowed metadata where the storage signature supports it; do not rely on browser size checks or CORS for security.
3. Complete is idempotent and only queues inspection. Observe object size/type; download through a bounded stream to an isolated temporary workspace.
4. Inspect **those exact bytes**: original length/hash, magic/type, dimension/pixel/animation/resource checks, SVG structure/policy where applicable, successful decode and preview rendering.
5. Write those verified original bytes to a new private immutable production key inaccessible through the upload URL, plus raster derivatives to separate keys. Persist digest and revision atomically with USABLE state only after successful writes.
6. Delete quarantine on success/failure; crash cleanup handles orphaned objects by owner/task IDs.

R2 presigned URLs can be reused before expiration. Therefore checking a mutable quarantine key and later using it directly creates a time-of-check/time-of-use bug. Promotion of the exact inspected byte buffer/file is mandatory. [S29]

### 12.2 Verification policy

Initial input types: SVG, PNG, JPEG. Preserve originals byte-for-byte; never replace the production original with sanitized/reencoded bytes. Declared extensions/MIME are hints, not verification. Initial resource budgets: 5 MiB file size, 40 megapixels decoded raster, 12,000-pixel maximum edge, one frame, 10-second inspection wall-clock and 256 MiB child memory. Tune from valid representative fixtures and hostile tests before release; changing a technical budget cannot silently change an already accepted artifact.

SVG must parse under a policy rejecting DTD/entities, scripts, event handlers, remote/file references, external fonts/stylesheets and unbounded/unsupported constructs. Permit local fragment references only within bounded expansion/resource rules. Embedded raster content must fit the same total decoded resource budget or be rejected. The original is retained unmodified only if the file passes; rendering uses a restricted in-memory representation in an isolated process.

Sharp/libvips performs decoding/rasterization and PNG/WebP derivatives. Set explicit pixel/error options; a library option is not an OS sandbox. Disable external network access and unnecessary filesystem access in the child, bound CPU/memory/time, kill the entire child process tree on timeout, and keep the native stack patched. Specific host mechanics can wait; the process-isolation requirement cannot. [S30]

Failures mean rejected artwork, not automatically accepted logo-later. The buyer can explicitly choose logo-later only when the merchant allows it. Pending inspection never becomes valid production artwork merely because a local browser preview succeeded.

### 12.3 Delivery and replacements

Original downloads are merchant-authorized, short-lived and `Content-Disposition: attachment`, with no inline arbitrary SVG served through the app origin. Buyer access is limited to safe derivatives for their own session/design. Presigned derivative URLs are short-lived; stored snapshots contain stable asset IDs/keys, not expired URLs.

Use a separate object origin and appropriate CORS for safe canvas images. Cache public merchant product previews separately from private buyer derivatives. Do not expose bucket listing or make buyer uploads public to solve canvas CORS.

Post-order upload uses the same inspection pipeline. Once USABLE, an authenticated merchant attaches a new revision to selected purchase placements with CAS/version checks. Preserve the original purchased selection and append the new production attachment. Locking records the attachment set; no overwrite of production history.

## 13. Failure policy and observability

### 13.1 Required behavior

| Failure | New commercial activity | Existing/purchased activity |
|---|---|---|
| Shopify pricing/context unavailable | No authoritative proposal/acceptance; 503, retryable | Existing offline offer may validate if its required Shopify Function inputs are available |
| PostgreSQL unavailable | No new quote, signing issue, upload grant or successful webhook acknowledgement | Existing Function authorization can continue independently; no invented snapshot until DB recovery/reconciliation |
| R2/inspection worker delayed | Artwork remains unusable; buyer sees processing | Existing retained originals remain accessible if storage responds; optional previews may degrade |
| Invalid/stale/mixed authorization set | No accepted customized checkout; repair path shown | No customization production entitlement inferred from plain/invalid properties |
| Function runtime failure | Explicit block-on-failure policy | May block even ordinary checkout during runtime outage; do not promise zero blast radius |
| Another transform changes/discards result | Independent validation rejects economic mismatch | No purchase at base price treated as a paid customization |
| Expired authorization, unchanged economics | Renew only with current valid entitlement/resources | Original quote remains immutable |
| Changed economics/context/config specification | Replacement quote and buyer review | Historical accepted offers valid until expiry unless security revoked |
| Partial, ambiguous or conflicting policy publication | Keep the requested revision pending; preserve known management evidence and withhold new issuance from it until activation is justified | Previous effective policy and valid accepted quotes retain their historical terms; reconcile or require operator action without rewriting purchases |
| Stale unaccepted session | Reload/revalidate current publication before authoritative price | Do not rewrite previously accepted quote records |
| No entitlement or removed feature | Disable new issuance for affected configurations | Honor valid old offers; retain purchase/artwork access within retention |
| Required product cannot be customized | Block rather than quietly sell it plain | Warn merchant; optional products can remain plain purchases |
| Malformed or excessive artwork | Reject file with actionable safe error | Never serve original as inline recovery or silently mark it usable |
| Partial/delayed webhook delivery | Recover by inbox retries and order reconciliation | Snapshot status remains reconciliation-required until verified |
| Historical unresolved usage effect | Lean usage staging/dispatch remains disabled | Preserve/reconcile genuine prior obligations; never infer billed success or back-bill the flat-plan period |
| Uninstall or Function removal | Stop backend commercial activity; enforcement cannot be guaranteed once removed | Privacy/uninstall policy applies; do not claim offline enforcement survives absent Functions |

For a missing Function configuration, a cart with any Insignia marker or required-product flag fails closed at checkout. Healthy plain optional carts may pass without Insignia processing. Unknown protocol, currency/context, corrupt keys or unsupported quantity boundaries are errors, not free purchases.

### 13.2 Observability

Pino uses structured events, request/attempt IDs, internal shop IDs and coarse error classes. Redact credentials, signatures/tokens, raw webhook bodies, artwork, buyer names/emails and presigned query strings. Do not use arbitrary user text as event names or metric labels.

prom-client metrics include quote latency/result, acceptance conflicts, expired/rejected set categories observed by application/test telemetry, active Function projection age/status, webhook backlog/oldest age, worker retry/rejection rates, inspection duration/resource rejection, recurring subscription freshness/state and deletion deadline/backlog; retain historical usage metrics only where they still serve recovery. Avoid per-order/cart/quote labels and uncontrolled shop cardinality. Rust Function observability uses supported Shopify logs/fixtures; it does not call the application's metrics endpoint offline.

Health endpoints separate process liveness, DB readiness, worker freshness and integration readiness. A globally healthy process does not mean each merchant's Functions/plan are healthy. Initial application SLO indicators and bounded tracing belong in the build; host alert thresholds and notification infrastructure remain deferred.

## 14. Testing strategy and executable gates

### 14.1 Testing layers

**Domain/Vitest:** exact Lean unit totals, missing versus explicit-zero prices, method/placement/size eligibility, currency/context rejection, quantity/variant identity, overflow and retention. Test safe exclusion of advanced configuration at editor/backend issuance/renewal boundaries. Keep historical setup/tier/FX/protocol fixtures where retained readers or old offers depend on them; do not turn their old success matrix into a Lean launch prerequisite. Use independent expected results and representative interactions, not arbitrary coverage/test-count quotas.

**Protocol:** shared positive/negative fixtures run in TS and Rust; real signature bytes, malformed inputs, overflow, strict verification, unknown versions, mixed shops/sets, date boundaries, duplicate/missing indices and transport roundtrips. Keep private fixture keys conspicuously test-only and never load them in production configuration.

**Database integration:** real PostgreSQL 18 with new-schema migrations. Test optimistic draft conflicts, concurrent acceptance dedup, publish/inbox/outbox crash points, multiple worker races, credential refresh CAS, key propagation state, tenant isolation, recurring-entitlement projections, immutable financial history and deletion replay. Mock databases cannot prove transaction invariants.

**Shopify adapter contracts:** pinned GraphQL schemas and normalized recorded responses, missing/partial errors, throttling/timeouts, exact Money string conversion, pagination, context mismatch and current/offline credential recovery. Redacted fixtures must exclude original artwork, bearer tokens and buyer PII.

**Browser/Playwright:** storefront reference states across desktop/mobile, keyboard/focus/accessibility, Shadow DOM/theme coexistence, variant-color preview switches, local UI↔canvas sync, upload states, price review, complete-cart replacement, arbitrary external cart edits, stale requests and expired renewal. Admin tests cover authenticated cold launch, draft/publish conflicts, entitlement restrictions and artwork lock.

**Real stores/Functions:** deploy exact release-built Wasm and input queries, capture actual Transform/Validation inputs, cart/order/refund data and authoritative recurring contract/trial/cancellation observations. Record Shopify plan, channel, API versions, app distribution mode, currency/tax settings, build hashes and test steps. A special development-store capability must not be mistaken for non-Plus production support.

### 14.2 Gate register — Lean V1 shipping criteria

The [15 October owner amendment](../delivery/authority/lean-v1-2026-10-15.md) narrows these existing gates prospectively. Dated G1–G8 results, failures and fixtures keep their original claims; no deferred capability becomes PASS. Reuse valid unchanged observations and qualify changed boundaries. The maintained [delivery state](../delivery/state.md) records actual completion, limits and owner dependencies; this plan is not an acceptance receipt. Relevant final-candidate CI and proportionate independent correctness/security review remain required.

| Gate | Lean executable acceptance | Deferred/history and failure boundary |
|---|---|---|
| **G1: non-Plus real-variant lifecycle** | Existing same-real-variant lineExpand through ordinary Online Store cart → checkout; representative variants/quantities/designs, correct actual garment/price/quantity/order bindings, single inventory decrement and native refund/restock behavior. Qualify representative merchant eligibility beyond special development capability. Clear Shopify component/group presentation is acceptable. | Separate Plus/lineUpdate is not shipping. Real garment/economic failure reopens this route; no fee product, variant pool or replacement checkout fallback. |
| **G2: measured Function capacity** | Release-built Transform and independent Validation include Ed25519/exact money; measure binary/instructions/input/output/memory with representative supported data and headroom, hostile bounded inputs and ordinary-cart coexistence. Explicitly reject beyond the qualified capacity. | Historical 1/10/32/64/larger and 10,000-unit probes remain evidence, not mandatory shipping promises or a universal cap. Never replace signatures with unsigned claims to pass a budget. |
| **G3: TS↔Rust/protocol preservation** | Canonical v2 bytes/signatures, complete members, malformed/mixed/date/epoch/rotation rejection, real cart/order carrier preservation and unchanged historical verification. | Frozen protocol/golden fixtures stay exact. A Lean profile constrains new inputs without relabeling old bytes or discarding valid offers. |
| **G4: supported prices/context/discounts** | Actual contextual base plus final selected-placement unit surcharges; qualified shop currency and primary-market path; EUR/USD/GBP enabled/advertised only individually after qualification. Preserve country/Market/currency checks. Qualify ordinary Shopify discounts on final merchandise and applicable tax/shipping/duties separation. Unsupported contexts give clear rejection/repair. | FX, per-currency overrides, extra Markets/currencies, dedicated product-page express and broad transform interoperability are not shipping. Unsupported routes/conflicts must still fail safely; no discount engine or merchant-wide setting changes. |
| **G5: exact Lean totals/scalar boundary** | Base once per physical garment plus each selected placement surcharge once; mixed variants/quantities/designs, explicit zero, missing unavailable, nonnegative final entries, checked exact decimal serialization/sums and coherent refunds. The €290 Lean example is an independent expectation. | New setup/tier/layer/adjustment/override behavior is excluded. Retain historical allocation/FX readers and golden examples; their old successful-behavior matrix is not a Lean blocker. No cent tolerance or silent zero fallback. |
| **G6: independent enforcement and recovery** | Required/optional modes; complete signed/economic verification; altered/incomplete/expired offers and unsupported entry points reject; missing/altered operations, detectable policy loss, current-enforcement drift and important publication failures remain safe within approved Option A. Lost mutation responses, line replacement/removal and ordinary cart edits reconcile/repair without blind retry or deadlock. | Broad third-party compatibility is deferred, not a bypass waiver. Approved unexpected joint-loss/coherent-rollback residual remains an incident; no stronger guarantee is invented. |
| **G7: useful authenticated admin/storefront** | Native merchant authentication, publish/copy/conflicts, simple price table, geometry/images, installation/readiness, purchase/historical preview/original retrieval, permitted merchant replacement/lock and retention indicators. Verify staff/tenant/privacy boundaries, important cold/deep/reload/recovery and representative desktop/mobile legacy visual/interaction fidelity. | No unrelated redesign, legacy admin/RFQ/ERP inheritance, buyer post-order upload expansion, usage dashboard or multi-plan comparison. Known defects remain defects, not owner-browser deferrals. |
| **G8: recurring-only subscription** | Actual USD $49.99/30-day single-plan contract, authoritative 14-day trial, cancellation/reauthorization/current entitlement, no-entitlement new-action restrictions, valid-old-offer handling and authorized retained artwork/history; usable merchant billing-management route. Qualify the flat-only reader against actual provider observations. | Hybrid meter/allowance/overage/sender/back-billing matrices are DEFERRED / NOT SHIPPING, not PASS. Preserve/reconcile genuine existing obligations and financial history. Disabling dispatch does not qualify recurring-only recognition. |

### 14.2.1 Current acceptance map — five owner-approved outcomes

Retain M0–M11/G1–G8 identifiers for traceability and useful existing dependency evidence. Delivery now closes the following five outcomes; there is no separate principal/milestone permission gate. An unchanged bounded feasibility result is not a new native PASS. Deferred features need exclusion tests, not completion of the historical matrix. New provider/store/deployment/test-checkout effects still require actual scoped grants; owner rollout and real-charge authority remain separate.

| Outcome | Reused mechanisms/evidence | Remaining acceptance boundary |
|---|---|---|
| **1. Lean pricing/currency scope** | Existing exact-money engine, configuration/revision history, v2/cart/Function path (G1–G6; M2/M4/M5/M7). | Editor and backend constrain final nonnegative method × placement × size prices; missing unavailable/explicit zero; no setup/tier/FX/layer/override new offers. Qualified primary-market shop-currency contexts only. Old accepted terms/expiry remain exact; incompatible new issuance/renewal requires a Lean replacement and review. |
| **2. Recurring subscription/entitlement/UI** | Existing installation/credential/current-provider readers and retained financial facts (G8; M4/M9). | Qualify actual recurring-only 49.99/30-day/14-day-trial contract, cancellation/reauthorization/new-action eligibility and merchant billing route. New usage staging/dispatch is disabled, no flat/trial-period back-billing; preserve/reconcile genuine prior effects. |
| **3. Complete native purchase/artwork journey** | Proven unchanged artwork/cart/order/purchase/payment/storage components and source-bound evidence (G1/G3/G4/G6; M5–M8). | Authenticate merchant → configure/publish Lean → buyer uploads/customizes/reviews → actual cart/permitted test checkout → independent worker order/payment reconciliation → durable purchase/first-paid → authenticated original and historical-preview retrieval. Qualify changed boundaries plus important rejection/repair/duplicate/restart/concurrency behavior. Test checkout is not a billable usage or rollout proof. |
| **4. Storefront/admin/privacy/recovery** | Actual legacy captures, shared visualizer, authentication, safe inspection/access, retained-record and cleanup controls (G6/G7; M5/M6/M8/M10). | Corresponding desktop/mobile appearance/interactions; complete usable Lean admin, historical previews, original downloads, merchant replacement/locking; privacy handling, actual object/payload retention/cleanup, credential rotation and important failure/restart behavior. Existing expiry/cleanup obligations continue throughout rescope. |
| **5. Reproducible operation/public-app readiness** | Versioned artifacts, scoped roles, host isolation, independent release authority, migrations and recovery evidence (G2/G3/G7/G8; M10/M11). | Versioned Docker images + Compose on VPS + Traefik HTTPS include web/worker/inspector/verifier responsibilities without agent sessions/mutable checkout. Qualify explicit host prerequisites, readiness, stop/restart, compatible migrations, backup/restore with erasure reapplication, rollback and actionable monitoring. Explain any unavoidable host application-service exception for owner decision. Applicable Shopify/public-app approvals and owner-authorized rollout remain due. |

Published historical Function resource ceilings remain reference evidence; qualify current pinned limits and measured headroom for the enabled profile. A physical garment count is not a signed-line count. [S4]

### 14.3 Release acceptance

A release-qualified Lean V1 satisfies all five outcomes above for its explicit enabled capacity/currency/Market/channel envelope, with meaningful tests, current evidence and no unresolved shipping defect. Deferred setup/tier/FX/Plus/express/usage capabilities are unavailable/not advertised; exclusion is verified without claiming their former gates passed. Reuse unchanged native evidence honestly; repeat affected boundaries on actual release artifacts.

Obtain applicable Shopify/public-app scope/protected-data/privacy/distribution approvals and owner rollout authorization. Test supported installation/theme activation, revocation/uninstall behavior, privacy and operational recovery under actual grants. Development-store success or a simulated test payment is not distribution approval or real-price invoice proof. [S23]

Compare actual corresponding legacy screenshots/interactions on representative supported desktop/mobile states; synthetic schematics or modal markdown alone do not prove fidelity. Preserve exact originals/history/retention and the unchanged Option A/protocol/tenant/resource boundaries.

## 15. Dependency-aware implementation sequence

**Historical sequence/current routing:** M0–M11 below retain dependency and evidence traceability; completed work is reused, not restarted. PF-001 and the original broad spike matrices remain historical entry records. Current shipping work closes the five Lean outcomes in §14; superseded capabilities are deferred/not shipping rather than still owed by their old milestone.

Only the small scaffolding necessary for a spike precedes platform risk proof. The full workspace/domain/database/admin build does not precede the foundational pricing/authorization evidence in section 14.2.1. G7/G8 can run in parallel with the pricing spike where independent. Entry evidence, feature acceptance and release acceptance are separate decisions; a partial gate observation does not satisfy an unproved substantive dependency.

### M0 — Platform, authorization, embedded-auth and billing proof

**Goal:** Establish the locked mechanisms can meet their invariants before building the full app.  
**Prerequisites:** This record; dedicated test-store/app access; current primary API schemas.  
**Created:** Minimal spike harness, provisional TS/Rust codec, two Functions, small Astro/Polaris auth harness, billing client harness, evidence directories.  
**Work:** Establish bounded feasibility and interface contracts for the original G1–G8 criteria using fixed test configurations/prices and minimal spike persistence. Capture actual parent/component/price inputs, representative public-app real-variant lifecycle and independent rejection, full-path resource measurements, embedded identity and provider contract/processing evidence. Record every remaining original criterion against its owning milestone in section 14.2.1.
**Tests:** Source-bound spike suites and reproducible merchant steps where authorized; preserve failed and unrun rows.
**Acceptance:** The engineering lead qualifies a reviewed bounded feasibility basis with build hashes, exact context, observed limits and no unresolved mechanism failure in the proposed M1 foundation. This is **not** a complete G1–G8 PASS. Narrow adapter/protocol contracts and later blocking criteria are explicit. Do not build the complete admin or production billing engine as a substitute for a spike.
**Commitment afterward:** Cart materialization and enforcement have a reviewed basis, not final production acceptance. Freeze a protocol only after the selected G3/G5 evidence and owner adoption for a material protocol change. No production data exists yet; a failed spike is cheap to discard.

### M1 — Workspace and enforced boundaries

**Goal:** A reproducible development/CI foundation, not a platform framework.  
**Prerequisites:** Reviewed M0 feasibility/contracts, including measured candidate capacity, public-app same-variant/economic-protection basis and known compatible versions. Applicable Lean criteria remain mapped by section 14.2.1.
**Created:** `apps/*`, package exports, Cargo workspace, pnpm lockfile, toolchain pin, minimal CI, dependency-cruiser rules.  
**Work:** Strict TS, browser/server entry boundaries, lint/type/test/build, versioned Shopify extension builds, secret scanning and immutable CI artifacts. Migrate proven spike code into narrow owned modules instead of copying everything.  
**Tests:** Import-rule negative fixtures, Node/Preact/Astro build, both Wasm builds, native Sharp smoke test in worker build image.  
**Acceptance:** A clean checkout installs/builds/tests; forbidden dependency imports fail CI; no React or react-konva workaround introduced.  
**Commitment afterward:** Public package exports and ownership boundaries; internal file names remain refactorable.

### M2 — Domain and executable economics

**Goal:** Complete pure configuration, identity and pricing invariants.  
**Prerequisites:** M0 normalization/capacity findings; M1.  
**Created:** `domain`, `contracts`, application port skeleton, pricing/identity fixtures.  
**Work:** Reuse groups/variant vectors, exact Money and existing engine/history; enforce the Lean final nonnegative per-placement unit-price profile at new authoring/issuance/renewal boundaries. Preserve immutable proposals/quotes and production readiness; advanced setup/tier/FX structures serve historical readers only.
**Tests:** Lean independent totals/missing-zero cases, unsupported configuration rejection, qualified currency/context, late/current revision and schema-version boundaries; retain unaffected historical engine examples where readers depend on them.
**Acceptance:** Lean pricing is deterministic and browser-independent; every garment/base/surcharge is counted exactly; historical economics stay unchanged; no server/network imports in domain.
**Commitment afterward:** Identity/pricing semantics and serialized schema version. Any later change to accepted economics needs a new version.

### M3 — Persistence, installation and durable delivery skeleton

**Goal:** Save new-system data safely and receive/recover events.  
**Prerequisites:** M1–M2.  
**Created:** Database migrations/repositories, application transactions, inbox/outbox, worker/pg-boss, Shopify credential adapter, logging/metrics.  
**Work:** Tenant constraints, draft/revision storage, command idempotency, expiring token rotation, installation generations, raw webhook ingress and transactional dispatch. Start deletion metadata now, not after data has accumulated.  
**Tests:** Real PostgreSQL transactions/races, webhook HMAC/duplicate/out-of-order cases, crash between enqueue and acknowledge, missing wrapping keys, refresh lost response.  
**Acceptance:** No acknowledged webhook is lost; retries do not duplicate business facts; stores cannot access each other's records.  
**Commitment afterward:** Database identity/tenant model and migration conventions; no production import compatibility promised.

### M4 — Shopify pricing, authorization and entitlement adapter

**Goal:** Replace spike fixtures with production ports for safe quoting.  
**Prerequisites:** M2–M3; accepted M0 contract evidence and representative G4 context contract. Establish actual recurring-only G8 trial/contract/cancellation behavior before accepting the corresponding entitlement rules.
**Created:** Catalog/context adapters (historical FX retained), server signer, key/Function reconciliation, subscription projections and feature-policy service.
**Work:** Batch contextual lookups, freshness checks, exact decimal boundary, known-currency matrix, publication-readiness projection, stable per-plan feature catalog structure and issuance authorization. Implement Shopify App Pricing contract reads early because publication and quote eligibility depend on them.  
**Tests:** Provider contract fixtures, expired/rotated credentials, unavailable/unsupported context, desired/observed drift, no-entitlement/downgrade rules and key overlap.
**Acceptance:** A programmatic immutable accepted quote yields the same validated prices as the spike; missing entitlement/pricing/config blocks issuance without affecting old valid offers.  
**Commitment afterward:** External adapter contracts, the separately adopted versioned protocol and feature identifiers; future incompatible change is explicit/versioned.

### M5 — Shared visualizer and new admin configuration

**Goal:** Merchant can configure, preview and publish a product.  
**Prerequisites:** M2–M4 and accepted G7 embedded identity/navigation feasibility.
**Created:** Visualizer package, page-local Preact editors, Astro routes and admin command endpoints.  
**Work:** Pure geometry projection, direct Konva editor, variant/color images, simple final method × placement × size price table, copy-to-product, draft CAS and publish readiness. Capture storefront visual fixtures in parallel, without porting legacy backend.
**Tests:** Geometry roundtrips/contain-fit, UI→canvas/canvas→UI, server/browser scene agreement, concurrent editing, missing preview fallbacks, required-feature errors.  
**Acceptance:** A merchant publishes a correct revision; changing the draft or defaults leaves historical revision/prices unchanged. Engineering readiness requires the implemented usable flow and relevant local qualification, with defects and named deferred native/browser observations explicit. Full native acceptance still requires G7 staff/session/browser/grant-cache/save-recovery and Option A readiness/activation evidence; it remains distinct from engineering review and rollout.
**Commitment afterward:** Serialized config/geometry contracts and merchant workflow; old published versions need readers, not mutation.

### M6 — Secure artwork vertical slice

**Goal:** Buyer/merchant artwork becomes genuinely usable through the safe pipeline.  
**Prerequisites:** M3; M5 for preview integration.  
**Created:** R2 adapter, upload/session endpoints, isolated inspector, derivative worker, artwork UI.  
**Work:** Direct quarantine upload, exact-byte immutable promotion, resource limits, ownership, safe previews, merchant original download and retention metadata.  
**Tests:** Valid SVG/PNG/JPEG, MIME spoofing, decompression bombs, external SVG references, timeout/memory kill, overwritten quarantine after inspection, retry/orphan cleanup, cross-tenant/expired URL access.  
**Acceptance:** No quote can use an unverified file; merchant gets byte-identical original; arbitrary SVG never executes inline.  
**Commitment afterward:** Asset revision/retention contract; processing changes receive an inspection version.

### M7 — Complete storefront quote/cart purchase slice

**Goal:** A buyer customizes, reviews cart-wide economics and checks out safely.  
**Prerequisites:** M4–M6 and accepted G1–G6 foundation contracts for the supported checkout path. Remaining G1–G6 criteria block M7 feature acceptance rather than the act of implementing the feature.
**Created:** Theme block/embed, Custom Element/Shadow DOM, Preact state, App Proxy contracts, proposal/acceptance/cart-application use cases.  
**Work:** Visual-reference flow, per-placement artwork/logo-later, size/color quantity vector, complete-subset Lean review/pricing, exact real-variant buckets, Lean-fenced renewal and outside-cart mutation repair through ordinary checkout; unsupported express routes reject safely.
**Tests:** Relevant browser/native acceptance, Lean prices and missing-zero exclusions, identical/different designs/variants/quantities, multi-tab/lost-response recovery, ordinary discounts and qualified primary-market contexts, pending/rejected files and required products; preserve historical split/tier fixtures without new scope.
**Acceptance:** Accepted pre-discount quote equals materialized total exactly; no unsupported path silently falls back to base-price customization; visual reference review passes. Remaining G1–G6 supported-context, resource, transport and enforcement criteria pass for this checkout path before it is accepted.
**Commitment afterward:** Storefront API v1, signed cart contract and buyer review behavior; backward compatibility for issued offers becomes necessary on deployment.

### M8 — Purchase snapshots, artwork work and refunds

**Goal:** Orders retain exactly what was bought and usable production originals.  
**Prerequisites:** M3 and M7.  
**Created:** Order/refund reconciliation, immutable purchase storage, minimal order/artwork admin.  
**Work:** Bind actual order lines to complete sets, capture historical config/geometry/images, append first-paid/refund facts, merchant-only later artwork/lock, reconcile missing webhooks and unsupported order edits.  
**Tests:** Delayed orders/create vs paid, repeat authorizations in distinct orders, real fulfillment/restock, partial refunds, late artwork replacement and immutable historical preview.  
**Acceptance:** Real product variants/quantities/prices are correctly visible and operable in Shopify; replacement artwork never overwrites purchase history.  
**Commitment afterward:** Purchase/event identities and audit semantics; real order data would require compatible readers.

### M9 — Recurring-only subscription and entitlement lifecycle

**Goal:** Qualify the single Lean recurring plan, authoritative trial/access behavior and useful merchant billing UI; prior usage work is deferred/not shipping.
**Prerequisites:** Existing installation/current-provider readers and trustworthy purchase/history records; actual approved provider configuration/selection authority before effects. Old hybrid feasibility does not prove recurring-only recognition.
**Work:** Adapt flat-only contract mapping for 49.99/30-day/14-day trial, cancellation/reauthorization/new-action eligibility, valid-old-offer and retained-artwork access. Disable new usage staging/dispatch for flat operation; preserve financial facts and resolve genuine prior obligations without retroactive charges.
**Tests/acceptance:** Actual contract/trial/cancellation observations and supported billing management; stale/absent/inactive state rejects new actions, history remains authorized within retention, no trial/flat back-billing. Outcome2/G8 in §14 governs completion; no allowance/meter/sender matrix is owed for Lean launch.
**Commitment afterward:** The actual recurring contract and versioned feature/access semantics. Owner terms, saved drafts and development effective-zero observations alone are not configured commercial acceptance.

### M10 — Recovery, retention, security and release qualification

**Goal:** Validate the integrated application's failure behavior before infrastructure release.  
**Prerequisites:** M3–M9.  
**Created:** Complete cleanup/reconciliation jobs, privacy export/redaction, fault-injection suites, operational readiness pages.  
**Work:** Collection deadlines/warnings, end-to-end object/payload erasure, uninstall/reinstall isolation, no-PII logs/jobs, fault drills, bounded queues/metrics and final App Store scope/privacy checklist.  
**Tests:** Kill workers around commits, drop webhook deliveries, rotate keys/tokens, simulate DB/Shopify/R2 failures, delete old artwork still referenced by unfinished orders, replay erasure after restore in a disposable environment.  
**Acceptance:** Every applicable supported failure in section 13 has an observed test; all applicable Lean §14 criteria are qualified on the release candidate; required public-app approvals and disclosures ready.
**Commitment afterward:** External privacy promises, security guarantees and compatibility envelope; changes must be deliberate and documented.

### M11 — Production environment and controlled release

**Goal:** Build the actual production environment using the proven application requirements.  
**Prerequisites:** Applicable Lean recovery/privacy/release evidence; close the remaining reproducible deployment outcome without restarting completed environment work.
**Created:** Host-specific deployment/backup/restore/monitoring implementation and runbooks.  
**Work:** Deliver versioned Docker images/Compose on the VPS with Traefik public HTTPS, including web/worker/inspector/verifier responsibilities. Qualify secrets delivery, host security prerequisites, DB recovery, R2 erasure-aware restore, isolation, compatible migrations and actionable monitoring. Agent sessions and mutable development checkouts cannot be normal runtime dependencies; explain any unavoidable host-side application-service exception for owner decision. Publish Shopify app/extensions and perform a controlled live merchant installation only with appropriate authorization.
**Tests:** Production-like restore, old/new Function/key/quote compatibility, readiness, rollback of code without rewriting accepted records, real merchant end-to-end acceptance.  
**Acceptance:** Proven recovery and release procedure, compatible external versions, operational ownership and no outstanding release-blocking gate.  
**Commitment afterward:** Live public contracts and merchant data. Rollback must preserve issued offers, purchase records and deletion commitments.

## 16. Implementation method for coding agents

The authoritative delivery procedure is `../delivery/operating-model.md`. This section retains architecture-specific implementation requirements. Read both before implementation; task/role templates and the tooling register are linked by the operating model.

### 16.0 Milestone engineering and native acceptance

The accountable lead owns delivery through the approved plan under the [operating model](../delivery/operating-model.md). At meaningful boundaries record integrated refs, cumulative behavior, evidence, defects, owner dependencies and cleanup obligations, then continue as substantive dependencies qualify. Principal review and separate milestone permission are retired prospectively. No deferred observation establishes full G7/M5/native acceptance or rollout eligibility.

Known implementation defects stay explicit. Missing native browser access permits continued independent development and ENGINEERING_READY / NATIVE_ACCEPTANCE_DEFERRED review; it does not excuse weak authentication or invent provider evidence. Current trust/freshness implementation is revisable under the operating model while preserving independent authority, true historical records and current authorization.

### 16.1 Work in narrow vertical slices

Each slice must name the use case, invariant, package owner and relevant gate evidence. Start from an input/output contract and failing test; implement domain rule, migration/repository and one adapter path, then exercise an end-to-end behavior. Do not build every table, endpoint and component horizontally before a buyer can perform one safe purchase.

Only create interfaces for actual external boundaries or genuinely separate callers. Prefer a concrete method like `publishProductConfig` over generic repositories/event-bus abstractions. Use explicit typed errors and transaction boundaries. Application owns orchestration; controllers and jobs adapt transport and invoke it.

### 16.2 Required change bundle

For a behavior-changing pull request, include the new/updated invariant test, implementation, schema migration when relevant, contract/schema version impact, failure/retention implications and current evidence for any altered Shopify assumption. Golden fixtures must change together across TypeScript and Rust. Do not update golden expected outputs merely to make a failing signature/price test pass without explaining the intended version change.

At a milestone, demonstrate the acceptance criteria, summarize risks and update the evidence/decision ledger. “Build succeeds”, “Shopify docs say it works” and “HTTP 202” do not substitute for the corresponding acceptance tests.

### 16.3 CI gates

Choose relevant strict typecheck, dependency-cruiser, unit/property/golden, PostgreSQL, Rust/Wasm, generated Shopify schema, Playwright, secret/dependency and release-build checks by change impact. Complete integrated qualification at milestone/release boundaries; harmless edits do not require every suite. Keep fixture keys out of production configuration and server-only code out of storefront bundles. Produce versioned artifacts with source revision and protocol/config/pricing versions.

Some real-store tests and billing-log checks require controlled external credentials/operator review. CI should mark those as required external evidence, not fabricate automated success. Destructive inventory/refund/uninstall tests run only in dedicated stores.

### 16.4 Schema/protocol evolution

Keep readers for historical config/quote/purchase versions needed during retention and operational audit. New writes use the latest explicit version; old snapshots are not silently rewritten. Never change a protocol field's meaning without a new version. Deploy verifier support before issuing a new protocol; keep old support through valid windows. Treat stored prices as records, not caches to recompute on library upgrade.

Online deployment compatibility is an application requirement under the reproducible Lean deployment target. Use additive migrations/backfills and separately authorized destructive cleanup. A rollback cannot make the previous application unable to decode offers the new one has already issued.

### 16.5 Stop/reopen rule

If a gate fails, preserve fixtures and record the smallest violated invariant, actual platform result, realistic alternatives and recommendation. Reopen only the impacted boundary. Do not respond by rebuilding React, using synthetic fee products, removing signatures, overriding tax, widening retained PII or introducing legacy migration code without an explicit decision.

Routine implementation tuning—indexes, retry intervals, resource budgets, file organization—does not require another architecture questionnaire. Material new business semantics or evidence that contradicts a lock does.

## 17. Decision ledger

This section mirrors `decision-ledger.md`; update both in the same reviewed change.

### LOCKED

**Authority/scope:** The [15 October owner-approved Lean V1](../delivery/authority/lean-v1-2026-10-15.md) prospectively amends pricing, supported surfaces, billing, deployment and release acceptance. Greenfield modular monolith; reuse the working rewrite. Legacy is the actual storefront appearance/interaction reference, with no legacy data migration/import.

**Stack/boundaries:** Strict TypeScript; Node 24 LTS; pnpm + Cargo; Astro 7 Node SSR; Preact admin islands and Vite storefront; Polaris Web Components; Custom Element + Shadow DOM; direct Konva in a shared framework-independent visualizer; Zod 4; PostgreSQL 18 + pg/Kysely; dbmate SQL; pg-boss; private R2; Sharp/libvips; Pino/prom-client; Vitest/Playwright/dependency-cruiser/GitHub Actions. Shopify JS SDK only inside Shopify adapter. Pure domain independent of framework, renderer, platform and persistence.

**Configuration:** One active ProductConfig per product, independent copy, mutable draft, immutable published revisions. New unaccepted pricing uses current permitted publication. Accepted quotes/orders retain historical revisions.

**Pricing/identity:** Product/revision-bound customization groups aggregate compatible size/color variants; different production design means a different group. New Lean configurations select one final nonnegative per-garment surcharge for each allowed method × placement × decoration-size choice; missing entries are unavailable, explicit zero is allowed. Add selected placement surcharges to each real variant’s contextual Shopify base price exactly once. New authoring/issuance/renewal excludes setup fees, quantity tiers, signed adjustments, additive pricing layers, scope switches, inheritance and currency overrides. Reuse the engine behind constrained backend/editor inputs; old advanced revisions remain readable and accepted offers retain original terms/expiry. An incompatible renewal needs a new Lean proposal and buyer review. Real variants and exact money remain mandatory.

**Checkout economics/security:** Accepted customized merchandise price is pre-discount; Shopify applies ordinary supported discounts and owns tax/shipping/duties/payment. Lean issuance uses the qualified primary-market path in the shop currency; EUR/USD/GBP are targets, each enabled/advertised only after qualification. Preserve actual country/Market/currency/contextual-price checks; unqualified contexts reject with safe repair, without changing merchant settings. New Lean offers use neither FX nor per-currency overrides. Immutable accepted quotes retain frozen values. Installation-scoped Ed25519, compact binary/no JWT whole-quote v2, complete-set verification, three shop-local calendar days and independent fail-closed economic validation remain. The [adopted v2 bytes/carriers](WHOLE-QUOTE-V2-ADOPTED.md) are unchanged; incompatible protocol changes require a new version and owner decision. No per-line fallback.

**Materialization/surfaces:** Retain ordinary non-Plus eligibility and same-real-variant one-child lineExpand; qualify representative merchants, not only a development store. Shopify component/group presentation is acceptable when garment/quantity/price/order handling stays correct and clear. Online Store one-time ordinary cart → checkout, App Proxy control and direct private presigned uploads remain. A separate Plus/lineUpdate branch, product-page express/Buy-now integration and broad third-party-transform compatibility are deferred/not shipping. Unsupported routes cannot bypass required customization or economic checks. Required products remain required; optional plain purchases retain their configured behavior. No paid customization with a selling plan.

**Required-product policy — approved Option A:** Within the supported enforcement conditions, v1 trusts correctly published, access-controlled app-owned Shopify policy and correctly operating Function inputs. Buyer-controlled markers are not policy authority. Reject unsigned or invalid authorization for identifiable required merchandise and detectable incomplete, malformed, pending, mismatched or wrong-installation policy; unrelated merchandise does not require a catalogue-wide authorization or outage. Unexpected complete loss or coherent rollback of *all* trusted product-policy evidence outside the supported publication contract may permit a formerly required unsigned plain purchase before detection. That residual risk is accepted as an incident to prevent, detect, contain and recover from; reconciliation cannot undo the purchase. Application-controlled unsafe publication remains a defect. The approved boundary and its limits are recorded in [OPTION-A-APPROVED.md](OPTION-A-APPROVED.md). Production publication, activation, reconciliation and gate evidence remain outstanding.

**Artwork/orders:** Byte-exact private SVG/PNG/JPEG originals, verified before use, safe PNG/WebP previews, no arbitrary inline SVG. Merchant-controlled logo-later; merchant-only post-order attachment. Append-only replacements; PENDING_ARTWORK → READY → ARTWORK_LOCKED. Immutable order-time purchase facts. Shopify owns payment/fulfillment/refunds/returns/restock; no garment/customization refund split.

**Billing/entitlements:** One recurring-only plan includes all released Lean V1 features: USD $49.99 per 30-day cycle and authoritative 14-day trial. No usage meter, included-order allowance, overage, per-order charge or retrospective billing for V1. Qualify actual recurring-only provider contract, trial, cancellation, reauthorization, entitlement and merchant billing-management route; disabling sends alone does not make the old flat-plus-meter reader compatible. No active entitlement means no new issuance/renewal; valid old offers retain normal expiry and authorized historical/artwork access remains within retention. Preserve prior financial facts and reconcile genuine obligations before transition; new usage staging/dispatch stays disabled. Technical resource limits remain; no unlimited-infrastructure promise.

**Retention:** Buyer artwork/identifying customization payloads at most six months from collection; abandoned uploads shorter; reuse does not reset expiry; merchant warning/export opportunity. Permitted minimal pseudonymized financial/audit facts may persist separately. Privacy/uninstall erasure includes derivatives/payloads and does not rewrite purchase economics.

**Delivery governance:** The [13 October autonomous direction](../delivery/authority/autonomous-delivery-2026-10-13.md), [approved Lean V1](../delivery/authority/lean-v1-2026-10-15.md) and [operating model](../delivery/operating-model.md) delegate useful implementation, proportionate review/testing, normal integration, permitted development deployment and continuation. The owner retains missing access/resources, human-only actions, new material product/risk decisions, unallocated effects and production rollout. Engineering completion, native qualification and rollout remain distinct. Versioned Docker images/Compose on the VPS with Traefik must reproducibly include web, worker, inspector and verification responsibilities; no agent session or mutable development checkout is a normal dependency. Preserve independent authority, real expiry/invalidation, host security prerequisites, retention and actual resource limits; explain any unavoidable host-side application-service exception to the owner.

### DEVELOPMENT GATES

Applicable G1–G8 mechanisms now support the five Lean outcomes in plan §14: non-Plus lineExpand; measured Function capacity and TS/Rust protocol; qualified primary-market shop-currency prices/ordinary discounts; exact Lean unit totals; independent required-product enforcement/repair; useful authenticated admin; and recurring-only provider entitlement. Setup/tier/FX/Plus/express/usage matrices are DEFERRED / NOT SHIPPING, never PASS. Unchanged historical controls remain evidence for their actual dependencies.

**Current state:** The maintained [delivery evidence register](../delivery/state.md) records partial observations, unresolved work and dated historical verdicts. No complete gate has been accepted; G7 and G8 have bounded observed sub-results but remain incomplete. Option A closes the joint-loss A/B owner decision but does not pass G6.

### ADOPTED PROTOCOL / UNQUALIFIED DEPLOYMENT

Whole-quote v2 is the single production implementation protocol. Its domain `Insignia\0WholeQuoteAuthorization\0v2\0`, `ISG2` magic, version 2, flags 0, 92-byte header, 22-byte ordered member record, shared `_insignia_quote_v2` and per-physical-line `_insignia_member_v2` carriers, exact Ed25519 message and canonical unpadded base64url are frozen. The current 32-bucket, 200-line, 10,000-physical-unit profile and 16,000-byte Transform output target are engineering admission guards, not a universal merchant capacity. Stack peak remains unmeasured against Shopify's 512 kB stack limit; measured supported-profile/live qualification remains due under Lean §14, with safe rejection beyond the qualified capacity. Historical stress examples are not mandatory commercial capacity targets. Protocol adoption authorizes no deployment, key activation, merchant publication or rollout.

### DEFERRED

Layered/setup/tier/FX/override pricing, usage billing, separate Plus implementation, dedicated express entry points and broad third-party interoperability are deferred/not shipping; qualify their safe exclusion rather than completing their old successful-behavior matrices. Keep historical readers/tests needed by valid offers, recovery and retention. Recurring-only provider configuration, reproducible deployment/recovery and applicable public-app approvals remain release work under Lean §14; owner terms are not provider evidence or effect permission. Legacy migration/import remains excluded.

---

## Source register — checked 24 September 2026

Primary sources document the external behavior noted in the plan. Linked references are rendered here as code URLs for portability. Recheck relevant versions at M0; do not assume future changes preserve these details. The implementation design itself is authored for Insignia and is not a paraphrase of any single source.

| Ref | Source and supported subject |
|---|---|
| S1 | Shopify Cart Transform reference, current 2026-07: availability, collision rules, fixed presentment pricing, operation shapes. `https://shopify.dev/docs/api/functions/latest/cart-transform` |
| S2 | Shopify Cart & Checkout Validation: costs, journey steps, local time and target schema. `https://shopify.dev/docs/api/functions/latest/cart-and-checkout-validation` |
| S3 | Cart Transform creation and validation configuration: `https://shopify.dev/docs/api/admin-graphql/latest/mutations/cartTransformCreate` ; `https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ValidationCreateInput` |
| S4 | Function runtime limits and execution overview; Rust build target. `https://shopify.dev/docs/api/functions/latest` ; `https://shopify.dev/docs/apps/build/functions/programming-languages/rust-for-functions` |
| S5 | Shopify App Pricing integration, Partner API state/history, changed notification model. `https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing` |
| S6 | Monthly combined subscription/usage contract. `https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/combined-subscription-and-usage` |
| S7 | Usage meters and graduated/volume billing. `https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-usage-charges` |
| S8 | App Events versioned creation, permanent billing idempotency, asynchronous validation and uninstall window. `https://shopify.dev/docs/api/app-events/latest/creating-events` |
| S9 | App Proxy authentication, signed query context and cookie/header behavior. `https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies` |
| S10 | Custom-framework embedded token exchange. `https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange` |
| S11 | Shopify contextual variant pricing. `https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariantContextualPricing` |
| S12 | Astro 7 release. `https://astro.build/blog/astro-7/` |
| S13 | Astro Node SSR and Preact integrations. `https://docs.astro.build/en/guides/integrations-guide/node/` ; `https://docs.astro.build/en/guides/integrations-guide/preact/` |
| S14 | Polaris iframe runtime/versioning and September 22, 2026 stable 1.1 release. `https://shopify.dev/docs/api/app-home/v1.0/web-components/versioning` ; `https://shopify.dev/changelog/polaris-cdn-1-1-is-now-stable` ; `https://shopify.dev/docs/api/app-home/latest` |
| S15 | Preact custom-element properties/events. `https://preactjs.com/guide/v10/web-components/` |
| S16 | Shopify Theme App Extension surface. `https://shopify.dev/docs/apps/build/online-store/theme-app-extensions` |
| S17 | Konva direct API/scene structure. `https://konvajs.org/docs/overview.html` |
| S18 | PostgreSQL 18, Kysely and pg type conversion. `https://www.postgresql.org/docs/18/release-18.html` ; `https://github.com/kysely-org/kysely` ; `https://node-postgres.com/features/types` |
| S19 | dbmate SQL migrations. `https://github.com/amacneil/dbmate` |
| S20 | pg-boss maintenance/runtime requirements and PostgreSQL queue design. `https://github.com/timgit/pg-boss` |
| S21 | Webhook HMAC verification. `https://shopify.dev/docs/apps/build/webhooks/verify-deliveries` |
| S22 | Shopify privacy compliance topics and handling. `https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance` |
| S23 | Shopify public-app requirements, privacy/security and protected-data review requirements. `https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements` |
| S24 | Insignia legacy storefront visual/interaction specification, GitHub blob SHA `58c82f5cc79faa0f12d2b35afe587732a2a58088`, retrieved through connected GitHub. `https://github.com/Optidigi/insignia/blob/main/docs/storefront/modal-spec.md` |
| S25 | Shopify Rust SDK exact source: `Decimal(pub f64)` and serialization, commit `9172367f54ab54eb631d82a0cdbea4601297886b`, retrieved through connected GitHub. `https://github.com/Shopify/shopify-function-rust/blob/9172367f54ab54eb631d82a0cdbea4601297886b/shopify_function/src/scalars/decimal.rs` |
| S26 | Node.js release/LTS schedule. `https://nodejs.org/en/about/previous-releases` |
| S27 | Zod 4 release and validation library baseline. `https://zod.dev/v4` |
| S28 | New-public-app expiring-token requirement; current token lifecycle and refresh recovery. `https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-public-apps-april-1-2026` ; `https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens` ; `https://shopify.dev/changelog/more-resilient-refreshes-for-expiring-offline-access-tokens` |
| S29 | Cloudflare R2 presigned URL semantics. `https://developers.cloudflare.com/r2/api/s3/presigned-urls/` |
| S30 | Sharp constructor/decode limits/options. `https://sharp.pixelplumbing.com/api-constructor/` |
| S31 | Shopify access scopes: least privilege, approval requirements and the default 60-day order access window. `https://shopify.dev/docs/api/usage/access-scopes` |

### Historical owner single-plan commercial amendment — 10 October 2026 (prospectively superseded by Lean V1)

The [owner decision](../delivery/authority/commercial-single-plan-2026-10-10.md) binds one all-released-feature paid plan, USD $49.99 per 30-day cycle, 100 included qualifying paid orders, USD $0.10 additional order fee and 14-day live trial with both fees waived. This prospectively changes current commercial configuration targets, not historical JSONB/receipts or old feature/downgrade/recovery semantics. G8 retains allowance/trial/first-paid/idempotency/cancellation/late-delivery/reconciliation requirements and historical plan-change compatibility controls; it no longer requires three new paid offers. Native pricing/development entitlement configuration and resource permissions are not fabricated. No M9/G8 execution, milestone completion or rollout is granted.
