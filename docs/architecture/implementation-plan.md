# Insignia — current specification and rationale

This is the canonical Lean V1 product, architecture and acceptance specification. [Current state](../delivery/state.md) owns progress, deployed identities, defects, assignments and the owner/operator checklist; the [operating model](../delivery/operating-model.md) owns delivery procedure and effective resource permissions. Read affected technical sections before changing behavior. The separately adopted [whole-quote v2 wire contract](WHOLE-QUOTE-V2-ADOPTED.md) remains authoritative for exact bytes.

Lean V1 is the sole supported first product version. Historical negotiation, milestone tasks and superseded decisions remain in Git history; the pre-closeout technical record is recoverable at commit `9d69dd5f440a383400e6e8af3bb93678d66f3b9f`. Current requirements incorporate approved Lean scope and unchanged security/economic obligations. This specification is neither an implementation receipt nor an external-effect grant.

## 0. Scope, evidence and completion rules

### 0.1 Product scope

Insignia is a public Shopify app for merchant-configured product customization. Buyers select decoration methods, placements, decoration sizes/steps, artwork or merchant-enabled logo-later, and quantities across compatible Shopify garment variants. Preserve the existing storefront UI/visual experience, adapting labels and review interactions where new pricing semantics require it. Maintain the current rewrite against these contracts; legacy admin screens, RFQ workflows, production management, fee products, variant pools, schemas and operational machinery are not inherited requirements.

There is **no migration/import work** in development: no importer, dual writes, compatibility views, old-ID mapping, legacy adapters, or migration milestones. Ordinary migrations of the *new application's own schema* are required and unrelated to importing legacy data.

Lean V1 supports ordinary non-Plus merchants through same-real-variant lineExpand and Online Store one-time ordinary cart → checkout. Separate Plus/lineUpdate, product-page express/Buy-now and broad third-party transform compatibility are deferred/not shipping; unsupported routes must not bypass required-product or economic enforcement. It does not offer negotiated Shopify B2B pricing, POS/headless integrations, subscription customization, an RFQ mode, or order-edit repricing. Shopify owns payments, fulfillment, cancellations, refunds, returns and inventory.

### 0.2 Evidence and qualification

Distinguish platform documentation, engineering inference, product requirement and observed behavior. Source references support platform facts; they do not prove application behavior. Current state records source-bound observations and their actual enabled context. Local completion, native qualification, owner visual acceptance and rollout approval are separate.

Reuse unchanged evidence and qualify changed boundaries under §14. Capability, admission budgets and native results are bounded by actual merchant, channel, currency/Market and permissions. Resource grants and actual expiry are never inferred from this specification. When a platform result contradicts an invariant, preserve evidence and reopen the affected boundary.

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
                   ├──> storage ──────> application ports + domain
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
    src/pages/api/admin/       # Authenticated merchant command/query endpoints
    src/pages/api/artwork/     # Artwork routes plus v1 buyer/App Proxy upstream
    src/pages/api/purchases/v1/ # Purchase/history/artwork contracts
    src/pages/api/webhooks/    # Raw-body Shopify/uninstall ingress
    src/islands/               # Preact only where interaction warrants it
    src/server/                # Server composition and transport boundaries
  worker/                      # Job registry, outbox dispatcher, composition
  storefront/                  # Vite + Preact, custom element, theme/cart bridge
packages/
  domain/                      # Config, pricing, money, identity, geometry, purchase rules
  application/                 # Use cases, ports, transactions, authorization policy
  contracts/                   # Zod 4 request/response schemas; browser-safe DTOs
  database/                    # pg/Kysely repositories, inbox/outbox, migrations
  shopify/                     # SDK boundary, auth, Admin/Partner/App Events clients
  storage/                     # Private R2 storage adapter
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
  shopify/                     # Curated availability replay input/provenance
# TS/Rust protocol vectors live under packages/cart-authorization/fixtures.
# Other curated fixtures live with their owning package/test, not a duplicate tree.
scripts/                       # Typed build, verification, release and recovery tools
deployment/                    # Compose, service declarations and typed operations
docs/architecture/             # Current specification and adopted protocol
docs/delivery/                 # Current state, operations and dated inert evidence
pnpm-workspace.yaml
pnpm-lock.yaml
Cargo.toml
Cargo.lock
rust-toolchain.toml
# No default root Shopify CLI app config is checked in.
# Scoped deployment TOMLs retain exact external identity; never infer a release grant.
```

Use explicit package exports. Client bundling must reject server exports of database, Shopify, artwork, signer and observability. Only `packages/shopify` imports `@shopify/shopify-api`; official Rust Function SDK dependencies belong inside Rust Functions. Framework-specific component types remain outside domain/contracts.

`packages/database/migrations` is the single source for application SQL migrations via dbmate. Do not also run a Kysely migration system. pg-boss owns its separate schema/version procedure. [S19, S20]

Derive exact Node/pnpm versions from root `package.json`, Rust from `rust-toolchain.toml`, dependencies from package manifests/lockfiles and compiler coverage from `scripts/boundaries/source-contract.mts`. Pin tested versions; pin Actions by commit. Initial library installation must pass the full build/type/test matrix. No floating `latest` in runtime deployment configuration. Zod 4 is boundary validation, not a reason to expose mutable ORM-shaped objects. [S27]

## 3. Domain model and invariants

### 3.1 Configuration and publication

**ProductConfig:** stable tenant-scoped identity attached to exactly one Shopify product. Owns one mutable draft and one current published-revision pointer. A unique `(shop_id, product_id)` constraint enforces the rule. Copying creates independent config identity and draft; no synchronized cross-product configuration relation.

**ProductConfigDraft:** schema-versioned editable JSON, optimistic `draft_version`, edit timestamp/actor. Stable IDs identify views, placements, methods and steps; array index is never a long-lived business identifier.

**ProductConfigRevision:** immutable schema-versioned publication with content hash, resolved pricing, production geometry, image revisions, allowed method/placement combinations, required/optional policy, logo-later permission, feature requirements and publication metadata. New Lean revisions freeze the complete final method × placement × size price table. Historical revisions retain their resolved defaults/overrides. Editing a method catalog entry must not mutate an existing revision indirectly.

**DecorationMethod:** stable merchant-defined label plus optional storefront labels and allowed artwork constraints. New Lean prices come from the final product price table. One method per selected placement in v1. Several selected placements may use different methods when the revision permits it.

**Placement/View/Step:** a placement belongs to a product view; a step is a merchant-defined decoration-size choice with scale/dimensions and prices. Garment S/M/L variants are not decoration steps. Support default images, variant/color image overrides, shared geometry and explicit variant overrides needed for the storefront.

Publication validates IDs, references, geometry, complete step schedules, currency codes, pricing scope, feature entitlements and asset readiness. Missing *optional preview* does not prohibit publishing or purchasing. Missing production-critical rule/selection validity does.

**Required-product trust (Option A):** trust correctly published, access-controlled app-owned Shopify policy and correctly operating Function inputs. Buyer markers are never policy authority. Detectable incomplete, malformed, pending, mismatched or wrong-installation policy rejects identifiable required merchandise; unrelated merchandise needs neither catalogue-wide authorization nor outage. Unexpected complete loss or coherent rollback of *all* trusted product-policy evidence outside the publication contract can allow a formerly required unsigned plain purchase before detection. That accepted residual is an incident to prevent, detect, contain and recover from; reconciliation cannot undo it. App-controlled unsafe publication remains a defect. The [Option A approval](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/architecture/OPTION-A-APPROVED.md) provides detailed boundaries and provenance. Merchant intent, a durable operation journal, Shopify mutation acknowledgement, exact Admin readback, Function observations and application activation are distinct states. An incomplete or ambiguous publication remains pending/error; it is not the effective policy. Preserve the previous effective policy, known management evidence and already accepted quote terms while resolving a transition. Production activation still requires a reviewed consistency/availability contract; a local model cannot prove platform-wide propagation.

**Availability transition:** FIRST_PUBLICATION/MODE_CHANGE uses effective-anchor v3; SAME_MODE remains no-hold. Generic discovery once omitted an effective third-party Publication that exact-ID lookup confirmed. Capture exact effective IDs and online-store presence, directly confirm every original Publication includes this product, hold DRAFT with zero effective visibility and unchanged original anchors, then restore exact original effective semantics. Provider `updatedAt` is diagnostic, never CAS/tolerance. Visible scheduled/staged publication fails closed; absence of arbitrary hidden non-effective intent is not guaranteed. Durable one-use acquisition/restoration/conditional-compensation claims precede dispatch; immutable versioned receipts fence replay. Only exact owned ACTIVE readback with settled semantic mismatch permits one compensating DRAFT rehold, becoming OPERATOR_HOLD. Ambiguous restore/compensation never retries. Retained v1/v2 JSONB and trusted recovery retain exact meanings and are never auto-upgraded.

V3 snapshots bind exact scope/product, normalized state, diagnostic provider timestamps, sorted effective Publication IDs, online-store publishedAt/URL presence, complete visible scheduled/staged projection, direct-anchor inclusion/capabilities, observed/received times and canonical digests. Direct queries are static/bounded, require exact returned Publication/product identity and complete pageInfo, and fail closed on duplicates/missing/null/permission/shape mismatch; the implementation guard of 64 anchors is not a merchant-capacity promise. Equality compares semantic state/membership/presence/capabilities, not diagnostic timestamps/URLs/publish dates alone.

A safe held snapshot is DRAFT, effectively invisible, unscheduled, with all original anchors still included and unchanged capabilities. Acquire compares the persisted before state, reserves a durable claim, sends one status-only DRAFT mutation and requires exact ACK plus complete held readback; already-safe DRAFT requires no mutation. Lost/ambiguous ACK never gains attribution from a later matching status. Restore requires the held/readiness fences, one durable claim, one status-only original-state update and complete readback. Exact original effective membership/presence is required. A single allowed compensation must itself read back held-safe; uncertainty remains RESTORATION_PENDING/operator incident with no retry.

Trusted recovery is observation-only absent separately authorized mutation; outstanding writes require `SETTLED_BY_TRUSTED_OPERATOR`. Nested version/tenant/product constraints and immutable receipts fence database replay; down migration fails closed when v3 records exist. The [original v3 decision](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/delivery/prompts/M5-017-AVAILABILITY-HOLD-V3.md) provides historical rationale, not reusable live-test authority.

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

**PricingRule:** new Lean authoring/publication/issuance permits one final nonnegative shop-currency unit surcharge per allowed method × placement × decoration-size choice. Missing is unavailable; explicit zero is a real price. Advanced rule roles/schedules/overrides are historical design references, not supported authoring or a requirement to retain development-version readers. Validate constrained inputs and overflow at backend boundaries as well as the editor.

**QuoteProposal:** immutable short-lived review output with desired group vector, config versions, contextual price evidence, pricing-engine version, totals and proposal hash. New Lean proposals carry no FX snapshot; actual retained historical evidence keeps its original meaning. It is not yet authorization to purchase.

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

Shopify owns discounts, tax, duties and shipping. Accepted customized merchandise remains pre-discount and uses the real variant’s normal tax treatment; qualification must preserve exact pre-discount Function economics and Shopify’s supported checkout adjustments. Required Shopify contextual-price lookup failure rejects the quote; browser prices, zero substitution and stale-market fallback are invalid. Application resolves external prices before pure domain evaluation.

Accepted quotes freeze resolved values and production specifications. Renewal compares current Lean eligibility, production, quantities, currency/Market and economics without overwriting original evidence; changed output requires a new proposal and review. Functions consume final signed amounts without currency conversion.

Earlier setup/tier/FX/scope/allocation algorithms and worked examples are historical design material in the fixed pre-Lean plan at `0c3672e2f38a7c6421f9b4791a3830c2db5aaaf8`. They are not a second active pricing specification or a requirement for compatibility-only code/tests. Preserve actual immutable purchase/preview economics, valid issued offers and unresolved recovery obligations under their original terms and expiry.

## 5. Signed cart authorization protocol

### 5.1 Scope and status

[Whole-quote v2](WHOLE-QUOTE-V2-ADOPTED.md) is the adopted production implementation contract; there is no per-line runtime fallback. Tokens are signed, not encrypted: “opaque” means the buyer UI treats them as opaque, not that the claims are secret. No artwork, buyer PII, price rules, JSON or JWT in cart authorization.

Use Ed25519, installation-scoped keys, and one shared v2 envelope plus a member carrier per physical line. Store private keys encrypted using authenticated encryption and a wrapping-key version held outside PostgreSQL. Use the Node crypto signer and maintained Rust Ed25519 verifier with strict verification; never implement curve arithmetic manually. Both Functions verify complete sets independently.

### 5.2 Adopted v2 wire contract

[WHOLE-QUOTE-V2-ADOPTED.md](WHOLE-QUOTE-V2-ADOPTED.md) is the single authority for wire layout, domain separation, signature input, member ordering, exact lengths and canonical encoding. It specifies the shared `_insignia_quote_v2` envelope and per-physical-line `_insignia_member_v2` carrier. TypeScript/Rust golden vectors and real Function transport controls must agree with that document. Reject unknown versions/flags, alternate encodings, padding, trailing bytes and overflow. A changed wire contract needs its own version and owner decision.

Human-readable cart summaries are informative only and cannot override signed identity/production data. Original artwork URLs never belong in cart properties.

### 5.3 Whole-set verification

Normalize actual physical priced items through the target-specific adapter; Qualified Shopify normalization determines which parent/component records represent them. Do not guess by double-counting parent and child. Then:

1. Classify plain optional lines versus required/Insignia-marked lines from independent product policy and reserved markers.
2. Decode each bounded token and verify key, signature, installation generation, epoch, local validity date, currency, country and market.
3. Require one quote ID and authorization-set ID across all customized lines; common headers, totals and expiry must agree.
4. Require each index `0..lineCount-1` exactly once; reject duplicates, missing members, extra members and mixed renewals. Platform-induced fragmentation is allowed only if G1 supplies a trustworthy deterministic normalization that reconstructs each bucket exactly.
5. Match real variant and quantity to each signed bucket; prohibit paid customization with a selling plan.
6. Checked-sum physical quantities and `quantity × unitMinor` using sufficiently wide intermediates; compare with signed totals.
7. Validator additionally compares **actual materialized pre-discount economic amounts**, not just signature claims or a transform-generated marker.

Submitting a complete offer and checking out only a subset fails completeness and quantity checks. Removing every marker on an optional product creates a plain purchase with no production customization, not an entitlement to free customization. Required products still reject unsigned purchases.

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


**Least-privilege scope contract.** The least-privilege adapter baseline requires `write_products` for app-owned product policy metafields (and its implied product read access), `read_orders`, `write_cart_transforms`, `write_validations`, `write_app_proxy`, and `read_markets` for the chosen market-resolution queries. Confirm each exact query/mutation against the pinned schema and remove any permission made unnecessary by its implementation. Request approval for `read_all_orders` before declaring it: default order access covers only orders created in the previous 60 days. The justification is reconciliation of known Insignia purchases, late payment/refund events and ongoing artwork work within retention—not a legacy import or unrestricted historical-data collection. [S31]

Approval is a release prerequisite for the promised older-order reconciliation path. Until granted, retain available purchase snapshots and expose restricted reconciliation explicitly; an authorization failure is not evidence that an order was deleted. Do not request order-write, inventory-write, fulfillment-write, theme-write or subscription-contract scopes merely to operate this design. Extra development-store test permissions do not belong in the public app scope manifest. Protected-customer-data review remains a separate approval requirement. [S23, S31]

### 6.2 Function installation and projections

Create one Insignia Cart Transform and one independent validation using the current handle-based installation APIs. Enable validation explicitly and set both applicable `blockOnFailure` flags. Those settings address runtime failures; they do not prove operation-collision safety. [S3]

Shop/product app-owned projections contain only what Functions need: installation generation, public key registry, epoch, protocol support, and required/optional product policy. No private keys, buyer artwork, detailed rules or quote JSON. Both Functions must read a compatible configuration version. Shopify is not a second quote database. App-controlled publication must preserve recognizable management evidence during an interrupted required-policy transition; a partial or malformed state remains detectable and rejects, rather than becoming optional by default. Option A accepts unexpected joint loss or coherent rollback of all trusted evidence *outside* the supported publication contract as a residual incident, not as normal publisher behavior.

Publication sequencing favors safe denial over transient unsigned required purchases. A mutation acknowledgement and exact Admin readback establish only their respective facts; one sampled Function invocation, repeated Admin reads or a fixed delay do not prove that every future Function input has the new revision. For stricter transitions, account for the previous effective policy and in-flight carts before exposing a product or enabling new quote issuance. If the needed activation/availability precondition is unverified, retain an explicit activation-pending state and the prior effective policy. Any temporary change to product availability is a separate, merchant-facing operation requiring its own reviewed precondition and effect; it is not automatic archival permission. Billing cancellation/downgrade never clears required flags or keys merely to ease checkout.

There is no generic Cart Transform fallback or separate Lean Plus branch. Retain and qualify the non-Plus G1 route: expand to one child with the same real variant, child quantity one relative to its parent, and the authorized fixed unit price. A failed G1 reopens that mechanism instead of enabling fee products behind the scenes.

### 6.3 Function behavior during cart mutations

Cart-wide replacement may require several Ajax operations. Do not demand complete sets during every intermediate cart mutation in a way that makes repair impossible. Cart mutation policy:

- Cart Transform returns prices only for a valid complete authorization set; invalid sets never receive new authoritative customization prices.
- During ordinary cart interaction, allow removal/replacement of stale or malformed lines. The storefront marks such state as requiring review and does not display a base-price fallback as an accepted customization.
- During checkout interaction and completion, the Validation Function enforces all authorization, required-product and economic checks. Unknown/missing journey context must not accidentally become a checkout bypass.

The current Validation API exposes buyer journey steps; verify their actual behavior on the supported ordinary cart → checkout route, with unsupported-entry bypass rejection. G6 must prove both non-bypassability and recoverability. [S2]

### 6.4 Context and cart integration

Use the Ajax Cart API for the Online Store cart through a theme-side adapter. App Proxy carries Insignia config, proposals, acceptance and upload control requests. The browser's claimed market/cart is a proposal; Shopify Functions independently compare checkout context.

Read pinned Shopify API versions from current extension/deployment TOMLs and adapter manifests; pin explicit tested versions for Admin, Functions and App Events, with separate contracts for APIs whose versioning differs. Check deprecations and generate input/output schemas in CI. Never rely on a `latest` URL at runtime or copy a deprecated field merely because it appeared in an example.

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

Uninstall additionally uses a private generation-specific APP_UNINSTALLED subscription destination, enrolled from verified current installation identity. Its exclusive destination plus raw HMAC binds purpose and generation; generic app-wide headers/body do not. Dispatch/unknown outcomes, exact readback, repair, old-generation fencing and separate immutable privacy recovery are required. Generic cleanup accounting is non-authorizing and never qualifies uninstall. See [lifecycle operations](../../deployment/lifecycle/README.md) for runtime limits and required native qualification.

Verify exact raw-body HMAC against the current/previous app-secret ring before durable admission. HMAC authenticates the body; unsigned topic, domain, delivery/event IDs, time, API version and name do not independently establish uninstall purpose or generation. An old authenticated body must never gain authority over a newer installation from that metadata. Generic receipts and old header-derived pending bindings cannot authorize generation deactivation, credential revocation, publication-pointer clearing or business completion. Historical processed facts remain unchanged; queue transport completion is distinct from privacy/uninstall fulfillment. Conservative bootstrap fencing retains its unsigned-metadata denial limitation and proves neither a genuine uninstall nor its absence. Permanent quarantine is not the accepted unattended-lifecycle solution; actual exclusive authority, callback reconciliation, registration-gap/reinstall/response-loss behavior and native qualification remain required. TLS/proxy/logging controls cannot supply cryptographic generation authority.

Mandatory privacy topics are customers/data_request, customers/redact and shop/redact. Verify raw request HMAC before parsing/trusting payloads. Acknowledge only after durable receipt. [S21, S22]

Deduplicate delivery on `(installation_id, webhook_delivery_id)` and make business processing idempotent independently. Track event ID/topic/API version/received time. An out-of-order event triggers reconciliation from Shopify rather than rolling back newer facts. Reconciliation paginates all order lines and refunds; never assume the first GraphQL connection page is complete.

The [13 October owner-delegated M8 decision](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/delivery/authority/m8-purchase-proof-ownership-2026-10-13.md) permits a distinct signed-offer/original-order matching proof for a qualified Online Store one-time flow. Preserve signature, complete physical members, actual merchandise/economics and historical authorization checks. Admit wholly unavailable actual localization only through trusted creator-origin/current-enforcement qualification; record it as unknown, with quote country/Market identified as authorized context. Independent provider context, when supplied, must still match. The [17 October native Lean journey](../delivery/evidence/lean-v1/native-lean-purchase-original-2026-10-17.json) qualifies the bounded USD/US development-store admission and purchase path. It does not qualify distribution or other contexts; no current-health observation becomes historical execution proof. Required-product enforcement and its incident limitations remain separate obligations.

Record orders at creation, bind approved customizations, and maintain first-full-payment facts. Refund processing appends Shopify economic facts without recalculating historical customization pricing; Lean V1 has no per-order app charge. Unsupported merchant order edits are recorded as discrepancies for review, not treated as newly authorized customization changes.

### 6.6 Recurring-only commercial contract

Use Shopify App Pricing authoritative subscription state through the isolated adapter, rather than older Admin Billing webhook assumptions. One plan includes all released Lean V1 features: USD $49.99 per 30-day cycle, with an authoritative 14-day trial. There is no usage meter, 100-order allowance, overage or per-order charge. Keep existing technical resource limits and disclose them honestly. [S5] The [Lean owner authority](https://github.com/Optidigi/insignia/blob/9d69dd5f440a383400e6e8af3bb93678d66f3b9f/docs/delivery/authority/lean-v1-2026-10-15.md) supersedes the historical 10 October hybrid target; saved provider drafts/current subscriptions remain actual facts, not automatically converted contracts.

Qualify actual recurring-only provider configuration and its supported billing-management/selection route before enabling it under a scoped effect grant. Use recurring-only entitlement recognition; the [17 October native billing lifecycle](../delivery/evidence/lean-v1/native-billing-lifecycle-2026-10-17.json) qualifies bounded zero-dollar development cancellation/reapproval, not a paid invoice or natural trial completion. Switching off usage dispatch alone does not qualify a provider contract. Read authoritative contract/trial/cancellation state through the supported Shopify adapter and keep a versioned feature mapping. Redirect parameters alone grant no entitlement. Server-side publication/new-offer/acceptance/renewal checks enforce supported features and Lean scope; UI hiding is insufficient.

### 6.7 Trial, inactive contract and historical access

The 14-day trial follows authoritative provider timestamps; do not reset it locally on selection, reinstall or restart. Qualify cancellation, stale/unknown state, reauthorization and new-action eligibility. Without a valid active trial/paid entitlement, stop new issuance/renewal while preserving valid old offers through their original expiry and authorized historical purchase/artwork access within retention. Required products never silently become plain purchases.

Earlier development configuration versions are not a supported product surface. Actual retained purchase/preview records and still-valid offers keep their original economics and expiry; new authoring/issuance/renewal uses Lean inputs. A changed design or price creates a new draft/revision and buyer-reviewed replacement. Shopify owns payment, refund and inventory operations.

### 6.8 Historical usage work — deferred, not shipping

Prior M9 ledgers, immutable intent/attempt identities, response classifiers and failed/partial native evidence retain their exact meaning; they are not recurring-only acceptance. Inspect existing financial facts and unresolved operations before transition, reconcile any genuine merchant obligation and preserve retention. New usage staging/dispatch is disabled for Lean flat-plan operation. Trial and flat-plan purchases are never back-billed later. No new meter, sender, allowance or per-event processing subsystem is a Lean launch prerequisite. Archived hybrid provider contracts/tests stay available where historical recovery genuinely depends on them.

## 7. Admin application

Astro owns routing, server authorization and rendering. There is no application-wide React/Preact router. Use Polaris for ordinary controls and page composition, plus Preact islands for the price editor, placement canvas, upload/preview and other genuinely stateful controls. Use direct App Bridge APIs, not React wrappers. Polaris and Preact support framework-independent custom elements, but their events/hydration/focus integration is tested in G7. [S14, S15]

### 7.1 Secure SSR boundary

Never return private merchant data merely because a request includes `shop`/`host` query parameters. Authenticated document requests may SSR their permitted content. A request without valid credentials returns only a minimal public bootstrap/shell; App Bridge obtains an identity token before private requests.

File-based pages use authenticated HTML fragments for read-only server-rendered sections and already-mounted page-local islands fetching authenticated DTOs for interactive sections. The fragment path returns trusted server-generated markup without inline application scripts; it is not a generic client router. Header-authenticated mutations use explicit endpoints. Locally implement and qualify cold-launch/deep-link/reload behavior, including whether a supported platform document-authentication mechanism removes the bootstrap step. Record unperformed native browser observations explicitly in current state. Do not add custom long-lived browser sessions or a SPA as an untested shortcut.

Set frame-ancestors for Shopify admin and the verified shop, use no-store on private responses, avoid logging URL credentials and enforce same-origin request protections alongside identity tokens. Load App Bridge and exactly one version-matched Polaris build. Read the tested Polaris runtime pin from `apps/web/src/layouts/AdminLayout.astro` and aligned types from the web package manifest; upgrades run visual/component regression tests. [S14]

### 7.2 Screens and use cases

**Installation/readiness:** plan status, scope/Function readiness, theme installation link, actionable errors; explicitly report conflict or required-product purchase restrictions.

**Product configuration:** product selection, one config, draft editor, copy-to-product, methods/placements/steps, final nonnegative price table (missing unavailable; explicit zero), shared/variant images, visualizer geometry, optional/required and logo-later switches. Show per-garment placement prices and their exact sum; retain useful imagery/geometry without setup/tier/layer/override controls.

**Publication:** optimistic save with conflict feedback, validate, preview, explicit publish. Return immutable revision and projection-readiness state. A stale editor receives 409, not silent last-write-wins. Copying snapshots editable content into an independent draft; no hidden linked config inheritance.

**Orders/artwork:** customized order overview, per-group historical preview and real-variant quantities, private originals, approved merchant-only post-order attachments, readiness/lock controls and retention expiry indicators. Shopify status is displayed as context, not reproduced as an Insignia fulfillment engine.

**Billing/settings:** verified recurring-only contract/trial dates, all-released-feature and technical-limit disclosure, plus supported billing management. No usage dashboard or multi-plan comparison; labels and server authorization use the same qualified versioned contract.

Do not automatically implement legacy RFQ, notes, CSV, reminder automation, QC or native order-block extensions. They are not scope through legacy inheritance.

### 7.3 Current merchant implementation map

**Disposition:** the merchant UI is owner-unaccepted and assigned to the fresh presentation-focused UI agent. Existing internal component, smoke and visual observations are engineering evidence only. Current layout is a replaceable implementation; the behavior and trust contracts here remain required. The continuity closeout does not start the rebuild. The explicit current assignment and acceptance work are in [state](../delivery/state.md).

| File-based merchant route | Capability and implementation entry |
|---|---|
| `/admin/products` | Product search/pagination and entry to the independent product config; `pages/admin/products/index.astro` |
| `/admin/products/:productId/config` | `MerchantConfigEditor.tsx`: draft/create/save/copy, method/placement/decoration-size prices, variant images, geometry, optional/required/logo-later, preview and publication reconciliation |
| `/admin/orders` and `/admin/orders/:purchaseId` | Immutable purchase list/detail, historical preview, actual variant quantities and permitted artwork workflow; `PurchaseArtwork.tsx`, `PurchaseHistoricalPreview.tsx` |
| `/admin/settings` | `MerchantSettings.tsx`: navigation and readiness/permissions; `ReadinessPermissions.tsx` |
| `/admin/settings/methods` | `MethodLibrary.tsx`: create/rename/remove merchant method templates with optimistic versions and uncertain-outcome handling |
| `/admin/settings/storefront` | `StorefrontSetup.tsx`: supported theme installation/setup guidance; not permission to publish a new theme/app version |
| `/admin/settings/billing` | `MerchantBilling.tsx`: authoritative recurring contract/trial/access and supported management route |
| `/admin/settings/privacy` | `MerchantPrivacy.tsx`: authorized privacy request/manifest/export reads; clear private data on authorization loss |
| `/admin/unavailable` | Public safe recovery shell; no private-data fallback |

Paths in the capability column are under `apps/web/src/` (`islands/` unless a page is specified). `/admin/billing` and `/admin/privacy` currently redirect to settings routes; redirects are navigation behavior, not separate product features. Discover the exact current route set from `apps/web/src/pages/admin/` and API route set from `apps/web/src/pages/api/`, rather than a copied file count.

**API and DTO ownership:** `pages/api/admin/` exposes products/config, methods, billing, readiness and signing operations. `server/admin/http.ts` authenticates/authorizes, enforces same-origin mutations, bounds requests, and routes commands. `server/admin/contracts.ts` owns server-only service/actor ports; `shared/admin-view.ts`, `billing-view.ts` and `purchase-view.ts` hold browser-safe views. `packages/contracts/src/v1/merchant-draft.ts` and `pricing-config.ts` validate current draft/pricing inputs; purchase/buyer/proposal schemas are adjacent. Purchase/history/privacy/attachment/lock routes are in `pages/api/purchases/v1/` with `server/purchase/http.ts`; upload/inspection/download routes are in `pages/api/artwork/` with `server/artwork/`. Read their concrete validators/handlers before changing payloads. Browser bodies never select a trusted tenant, staff identity or private object key.

**Shared request and save behavior:** `shared/admin-request.ts` obtains App Bridge identity tokens, shares only an in-flight token request, applies bounded request deadlines, disables cache/browser credentials/redirects, and makes one fresh-token retry on 401. It preserves typed HTTP status/validation errors. `layouts/AdminLayout.astro`, `components/AdminNavigation.astro`, shared navigation/page-ready/route utilities and skeleton/recovery components own the transitive merchant shell. `components/AdminSaveBar.tsx` delegates to supported App Bridge host Save Bar when available and uses Polaris fallback otherwise. Dirty navigation/discard requires confirmation; unknown writes remain owned by the exact original request and cannot be cleared by discard/navigation. Editor CAS/idempotency and publication journals remain authoritative across reload, conflicts and lost responses.

**Presentation boundary:** actual App Home Polaris Web Components cover merchant pages and transitive shared controls, dialogs, loading/error/empty/recovery states, with appropriate Shopify page composition and reviewed responsive behavior. Component tags or HTTP 200 alone are insufficient. Supported App Bridge host declarations are preserved. `packages/visualizer` exclusively owns Konva; editor state/normalized geometry remains outside canvas nodes. The buyer Shadow DOM storefront remains separate and does not import Polaris.

**Verification and preview:** `apps/web/test/admin/` contains the current auth/session, command/editor/CAS/publication, shared-control/navigation, billing/privacy/purchase and composition/browser regressions; source guard/type/rendered controls enforce the merchant closure. Find supported scripts in root/web `package.json`, strict projects through the source-contract manifest, and browser prerequisites through README. After building, `pnpm dev:admin` runs loopback-only compiled SSR with synthetic read-only data; `INSIGNIA_PREVIEW_STATE` supports `normal`, `empty`, `denied`, `unavailable`, `loading`. It deliberately excludes ambient application credentials and blocks commands, webhooks, proxy and upload writes. Browser command fixtures qualify mutation/reconciliation states; preview does not prove native authorization, provider outcomes or owner visual acceptance. Existing native browser access must be rechecked under actual scoped permissions.

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

The buyer flow is implemented by `server/buyer/http.ts` behind `pages/api/artwork/v1/[...route].ts`; uploads have the separate `pages/api/artwork/guest/` handlers. Paths shown as `/v1/...` below are relative to the configured buyer upstream `/api/artwork/v1`; explicit upload paths are separate transports. They are current flow contracts, not a second router to implement; published storefront URLs use the configured proxy mount. API version is explicit. Requests and responses are Zod-validated, size bounded and return a stable error envelope `{code,message,requestId,details?}` with no secret payloads.

| Method/path | Input and result |
|---|---|
| GET `/v1/config` | Product and current selection context → current published revision ID, safe config DTO, image/placement choices and readiness |
| POST `/v1/sessions` | Signed shop context → guest capability and expiry; rate-limited, no cookie reliance |
| POST `/api/artwork/guest` | Capability, declared metadata, idempotency key → upload ID, quarantine PUT URL, constraints and expiry |
| POST `/api/artwork/guest/:id/complete` | Capability + upload ID → idempotently queue inspection, return status |
| POST `/api/artwork/guest/:id/status` | Owner capability → inspection result and safe derivative reference; never arbitrary object-key access |
| PUT `/v1/designs/:id` | Versioned selection/variant vector → validated draft version; conflict is 409 |
| POST `/v1/quote-proposals` | Complete desired customized subset and context → proposal ID/hash, breakdown, total Q, expiry, changed groups |
| POST `/v1/quote-proposals/:id/accept` | Expected proposal hash, capability and idempotency key → immutable quote, set ID, real-variant bucket vector and tokens |
| POST `/v1/quotes/:id/renew` | Owner capability and current desired/context vector → fresh set, or 409 REVIEW_REQUIRED, or entitlement denial |
| POST `/v1/cart-state` | Owner capability and observed signed lines → current complete-set state for safe repair |
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

Publish intent: compare draft CAS version → validate → insert immutable requested revision and durable publication operation/outbox record in one transaction. Do not move the effective published pointer before the activation contract is satisfied. Shopify mutation and exact readback occur outside the transaction; an ambiguous response is reconciled by reading the exact desired state before retry or conflict classification. Activation separately advances the effective pointer only under the reviewed preconditions. In-memory journal tests model restart and ordering, not durable database transactions.

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

Default transient policy: exponential backoff with jitter from 5 seconds, cap 15 minutes, up to 12 automated attempts before review; honor provider Retry-After and tighter billing deadlines. These values are tuning defaults, not host-specific alert thresholds. Recurring reconciliation is independent of exhaustion of an individual job. Separate CPU-heavy image concurrency from webhook/billing queues to prevent upload floods starving economic processing.

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

Health endpoints separate process liveness, DB readiness, worker freshness and integration readiness. A globally healthy process does not mean each merchant's Functions/plan are healthy. Application SLO indicators, bounded tracing and actionable operational alerts are required. The current alert/heartbeat implementation is documented in [deployment/alerts](../../deployment/alerts/README.md); source and local qualification do not establish actual provider mail delivery or outage/recovery behavior.

## 14. Testing strategy and executable gates

Maintained source, tests, fixtures and operational tooling use strictly compiled TypeScript/TSX/MTS/CTS or Rust. Runtime type stripping alone is insufficient. Generated JavaScript and dependencies retain provenance. SQL/PLpgSQL, Liquid, CSS, HTML and declarative infrastructure keep their formats; shell launchers remain thin. Source checks derive coverage from actual compiler projects rather than copied counts. Preserve applied migration bytes, protocol/persisted identities, current recovery readers and necessary records; assess database routines by responsibility, never by a language statistic.

### 14.1 Testing layers

**Domain/Vitest:** exact Lean unit totals, missing versus explicit-zero prices, method/placement/size eligibility, currency/context rejection, quantity/variant identity, overflow and retention. Test safe exclusion of advanced configuration at editor/backend issuance/renewal boundaries. Keep historical protocol/economic fixtures where actual retained records or unexpired offers depend on them; retire compatibility-only checks for unsupported development versions; do not turn their old success matrix into a Lean launch prerequisite. Use independent expected results and representative interactions, not arbitrary coverage/test-count quotas.

**Protocol:** shared positive/negative fixtures run in TS and Rust; real signature bytes, malformed inputs, overflow, strict verification, unknown versions, mixed shops/sets, date boundaries, duplicate/missing indices and transport roundtrips. Keep private fixture keys conspicuously test-only and never load them in production configuration.

**Database integration:** real PostgreSQL 18 with new-schema migrations. Test optimistic draft conflicts, concurrent acceptance dedup, publish/inbox/outbox crash points, multiple worker races, credential refresh CAS, key propagation state, tenant isolation, recurring-entitlement projections, immutable financial history and deletion replay. Mock databases cannot prove transaction invariants.

**Shopify adapter contracts:** pinned GraphQL schemas and normalized recorded responses, missing/partial errors, throttling/timeouts, exact Money string conversion, pagination, context mismatch and current/offline credential recovery. Redacted fixtures must exclude original artwork, bearer tokens and buyer PII.

**Browser/Playwright:** storefront reference states across desktop/mobile, keyboard/focus/accessibility, Shadow DOM/theme coexistence, variant-color preview switches, local UI↔canvas sync, upload states, price review, complete-cart replacement, arbitrary external cart edits, stale requests and expired renewal. Admin tests cover authenticated cold launch, draft/publish conflicts, entitlement restrictions and artwork lock.

**Real stores/Functions:** deploy exact release-built Wasm and input queries, capture actual Transform/Validation inputs, cart/order/refund data and authoritative recurring contract/trial/cancellation observations. Record Shopify plan, channel, API versions, app distribution mode, currency/tax settings, build hashes and test steps. A special development-store capability must not be mistaken for non-Plus production support.

### 14.2 Gate register — Lean V1 shipping criteria

G1–G8 identify the applicable Lean acceptance mechanisms. Dated results, failures and fixtures keep their original claims; no deferred capability becomes PASS. Reuse valid unchanged observations and qualify changed boundaries. The maintained [delivery state](../delivery/state.md) records actual completion, limits and owner dependencies; this plan is not an acceptance receipt. Relevant final-candidate CI and proportionate independent correctness/security review remain required.

| Gate | Lean executable acceptance | Deferred/history and failure boundary |
|---|---|---|
| **G1: non-Plus real-variant lifecycle** | Existing same-real-variant lineExpand through ordinary Online Store cart → checkout; representative variants/quantities/designs, correct actual garment/price/quantity/order bindings, single inventory decrement and native refund/restock behavior. Qualify representative merchant eligibility beyond special development capability. Clear Shopify component/group presentation is acceptable. | Separate Plus/lineUpdate is not shipping. Real garment/economic failure reopens this route; no fee product, variant pool or replacement checkout fallback. |
| **G2: measured Function capacity** | Release-built Transform and independent Validation include Ed25519/exact money; measure binary/instructions/input/output/memory with representative supported data and headroom, hostile bounded inputs and ordinary-cart coexistence. Explicitly reject beyond the qualified capacity. | Historical 1/10/32/64/larger and 10,000-unit probes remain evidence, not mandatory shipping promises or a universal cap. Never replace signatures with unsigned claims to pass a budget. |
| **G3: TS↔Rust/protocol preservation** | Canonical v2 bytes/signatures, complete members, malformed/mixed/date/epoch/rotation rejection, real cart/order carrier preservation and unchanged historical verification. | Frozen protocol/golden fixtures stay exact. A Lean profile constrains new inputs without relabeling old bytes or discarding valid offers. |
| **G4: supported prices/context/discounts** | Actual contextual base plus final selected-placement unit surcharges; qualified shop currency and primary-market path; EUR/USD/GBP enabled/advertised only individually after qualification. Preserve country/Market/currency checks. Qualify ordinary Shopify discounts on final merchandise and applicable tax/shipping/duties separation. Unsupported contexts give clear rejection/repair. | FX, per-currency overrides, extra Markets/currencies, dedicated product-page express and broad transform interoperability are not shipping. Unsupported routes/conflicts must still fail safely; no discount engine or merchant-wide setting changes. |
| **G5: exact Lean totals/scalar boundary** | Base once per physical garment plus each selected placement surcharge once; mixed variants/quantities/designs, explicit zero, missing unavailable, nonnegative final entries, checked exact decimal serialization/sums and coherent refunds. The €290 Lean example is an independent expectation. | New setup/tier/layer/adjustment/override behavior is excluded. Retain actual historical economics and needed protocol/record fixtures; unsupported development allocation/FX readers and compatibility-only tests are not shipping obligations. No cent tolerance or silent zero fallback. |
| **G6: independent enforcement and recovery** | Required/optional modes; complete signed/economic verification; altered/incomplete/expired offers and unsupported entry points reject; missing/altered operations, detectable policy loss, current-enforcement drift and important publication failures remain safe within approved Option A. Lost mutation responses, line replacement/removal and ordinary cart edits reconcile/repair without blind retry or deadlock. | Broad third-party compatibility is deferred, not a bypass waiver. Approved unexpected joint-loss/coherent-rollback residual remains an incident; no stronger guarantee is invented. |
| **G7: useful authenticated admin/storefront** | Native merchant authentication, publish/copy/conflicts, simple price table, geometry/images, installation/readiness, purchase/historical preview/original retrieval, permitted merchant replacement/lock and retention indicators. Verify staff/tenant/privacy boundaries, important cold/deep/reload/recovery and representative desktop/mobile legacy visual/interaction fidelity. | No unrelated redesign, legacy admin/RFQ/ERP inheritance, buyer post-order upload expansion, usage dashboard or multi-plan comparison. Known defects remain defects, not owner-browser deferrals. |
| **G8: recurring-only subscription** | Actual USD $49.99/30-day single-plan contract, authoritative 14-day trial, cancellation/reauthorization/current entitlement, no-entitlement new-action restrictions, valid-old-offer handling and authorized retained artwork/history; usable merchant billing-management route. Qualify the flat-only reader against actual provider observations. | Hybrid meter/allowance/overage/sender/back-billing matrices are DEFERRED / NOT SHIPPING, not PASS. Preserve/reconcile genuine existing obligations and financial history. Disabling dispatch does not qualify recurring-only recognition. |

### 14.2.1 Integrated outcomes

The five outcomes are Lean pricing/currency scope; recurring subscription/entitlement; native purchase-to-original journey; storefront/admin/privacy/recovery; and reproducible operation/public-app readiness. The gate table and corresponding technical sections define their criteria. Old milestone IDs in evidence identify historical dependencies; they create no separate approval checkpoint or obligation to replay superseded matrices.

Function capacity is a measured enabled profile with headroom, not a universal merchant capacity. Physical garment count differs from signed-line count. Qualify pinned platform limits and reject beyond current admission guards. [S4]

### 14.3 Release acceptance

A release-qualified Lean V1 satisfies all five outcomes above for its explicit enabled capacity/currency/Market/channel envelope, with meaningful tests, current evidence and no unresolved shipping defect. Deferred setup/tier/FX/Plus/express/usage capabilities are unavailable/not advertised; exclusion is verified without claiming their former gates passed. Reuse unchanged native evidence honestly; repeat affected boundaries on actual release artifacts.

Obtain applicable Shopify/public-app scope/protected-data/privacy/distribution approvals and owner rollout authorization. Test supported installation/theme activation, revocation/uninstall behavior, privacy and operational recovery under actual grants. Development-store success or a simulated test payment is not distribution approval or real-price invoice proof. [S23]

Compare actual corresponding legacy screenshots/interactions on representative supported desktop/mobile states; synthetic schematics or modal markdown alone do not prove fidelity. Preserve exact originals/history/retention and the unchanged Option A/protocol/tenant/resource boundaries.

## 15. Evolution and operation

Lean V1 is the sole supported product version. Keep historical readers only for demonstrated retained purchase/preview records, unexpired issued offers or unsettled recovery obligations. Dated evidence alone does not justify compatibility machinery. New writes use the explicit current version; immutable snapshots and stored prices are records, not caches to recompute on upgrade. Deploy verification support before issuing a changed protocol and retain support through valid offer windows.

Use additive migrations/backfills for online compatibility and separately authorized destructive cleanup. Rollback must decode offers already issued by the new version and preserve purchase records/deletion commitments. Applied migrations remain immutable. Database tenant/economic/erasure constraints, triggers and narrow privileged routines retain their enforced responsibility rather than moving into broadly privileged application code.

Normal operation uses versioned Docker images and Compose with Traefik HTTPS for web, worker and independent verifier; no agent session or mutable development checkout is a runtime dependency. The approved narrow exception is the existing isolated artwork-inspection host service, running an independently verified immutable CI package under its sandbox/grants. This does not authorize another host service. Current runbooks and the checklist linked from [state](../delivery/state.md) carry environment-specific access, custody, grants, recovery, monitoring and rollout actions. Engineering qualification never waives independent authority, actual expiry or owner-held production actions.

## Platform reference register

These primary-source pointers explain platform choices. They are a reference index, not current capability receipts; recheck affected versioned APIs before changing behavior. Manifests and source-bound observations determine tested versions. Historical-only usage-billing research remains in Git history.

| Ref | Source and supported subject |
|---|---|
| S1 | Shopify Cart Transform reference, versioned availability, collision rules, fixed presentment pricing, operation shapes. `https://shopify.dev/docs/api/functions/latest/cart-transform` |
| S2 | Shopify Cart & Checkout Validation: costs, journey steps, local time and target schema. `https://shopify.dev/docs/api/functions/latest/cart-and-checkout-validation` |
| S3 | Cart Transform creation and validation configuration: `https://shopify.dev/docs/api/admin-graphql/latest/mutations/cartTransformCreate` ; `https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ValidationCreateInput` |
| S4 | Function runtime limits and execution overview; Rust build target. `https://shopify.dev/docs/api/functions/latest` ; `https://shopify.dev/docs/apps/build/functions/programming-languages/rust-for-functions` |
| S5 | Shopify App Pricing integration, Partner API state/history, changed notification model. `https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing` |
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
| S24 | Historical legacy storefront reference identifier: Git blob `58c82f5cc79faa0f12d2b35afe587732a2a58088`. It is absent from this clone, and the connected repository blob lookup returned 404 during closeout. The [buyer visual action](../delivery/state.md#owneroperator-checklist) owns obtaining the approved source/captures; this identifier is not currently retrievable visual evidence. |
| S25 | Shopify Rust SDK exact source: `Decimal(pub f64)` and serialization, commit `9172367f54ab54eb631d82a0cdbea4601297886b`, retrieved through connected GitHub. `https://github.com/Shopify/shopify-function-rust/blob/9172367f54ab54eb631d82a0cdbea4601297886b/shopify_function/src/scalars/decimal.rs` |
| S26 | Node.js release/LTS schedule. `https://nodejs.org/en/about/previous-releases` |
| S27 | Zod 4 release and validation library baseline. `https://zod.dev/v4` |
| S28 | New-public-app expiring-token requirement; current token lifecycle and refresh recovery. `https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-public-apps-april-1-2026` ; `https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens` ; `https://shopify.dev/changelog/more-resilient-refreshes-for-expiring-offline-access-tokens` |
| S29 | Cloudflare R2 presigned URL semantics. `https://developers.cloudflare.com/r2/api/s3/presigned-urls/` |
| S30 | Sharp constructor/decode limits/options. `https://sharp.pixelplumbing.com/api-constructor/` |
| S31 | Shopify access scopes: least privilege, approval requirements and the default 60-day order access window. `https://shopify.dev/docs/api/usage/access-scopes` |
