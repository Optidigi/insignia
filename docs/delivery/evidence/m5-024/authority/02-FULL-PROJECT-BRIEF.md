# Authority note

This is a refreshed full product brief derived from the prior handed-off project brief. The live decision ledger and implementation plan always control. Current PR54/M5-024 state is in `01-LIVE-CHECKPOINT.md` and `05-M5-024-AUTHORIZED-SLICE.md`.

---

# Insignia Rewrite — full project brief

## 1. What Insignia is

Insignia is a greenfield public Shopify app that lets a merchant configure customizable products and lets buyers later customize those real Shopify variants with decoration/artwork/placement options. The rewrite is intended to replace a legacy custom app while preserving the purpose and, eventually, the storefront visual experience where useful.

This is **not** a legacy migration project. The old repository/app is a visual/behavior reference only. No import/migration contract is part of the current baseline.

The long-term flow is:

merchant configures ProductConfig in embedded admin
→ immutable published revision becomes effective after trusted activation
→ storefront reads active configuration
→ buyer customizes product/artwork/placement/size quantities
→ Insignia quotes deterministically
→ cart/checkout contains the merchant's real Shopify variants with customization economics materialized through Shopify-supported mechanisms
→ completed orders retain exactly what was purchased
→ artwork/order/billing/retention workflows operate on durable immutable facts.

## 2. Architectural style

Greenfield **modular monolith** with hard package boundaries, not microservices.

Primary goals:
- maintainability
- explicit pure domain/application seams
- Shopify isolated at adapters
- deterministic pricing/authorization
- easy staged growth from core into artwork/storefront/orders/billing
- durable evidence and recovery rather than implicit best-effort provider state.

## 3. Locked production stack

| Concern | Locked choice |
|---|---|
| Language | TypeScript strict mode |
| Runtime | Node.js 24 LTS |
| Workspace | pnpm workspaces |
| Web/admin | Astro 7 standalone Node SSR |
| Interactive UI | Preact |
| Admin UI | Polaris Web Components |
| Storefront isolation | Custom Element + Shadow DOM |
| Canvas renderer | direct Konva, shared renderer; no React/react-konva |
| Validation | Zod 4 |
| Database | PostgreSQL 18 |
| Query layer | pg + Kysely |
| Migrations | dbmate |
| Jobs | pg-boss |
| Object storage | private R2 |
| Image processing | Sharp/libvips |
| Logging/metrics | Pino + prom-client |
| Tests | Vitest + Playwright + dependency-cruiser + GHA |
| Shopify SDK | adapter-side only |
| Functions | Rust Shopify Functions + shared authorization verifier |

Repository language percentages are intentionally distorted by preserved spikes/evidence/tooling. See `12-ARCHITECTURE-LANGUAGE-AUDIT.txt`. Production application source remains TypeScript-centric with Rust Functions and SQL persistence.

## 4. ProductConfig lifecycle

- One active ProductConfig per Shopify product.
- ProductConfig has mutable draft state.
- Published revisions are immutable.
- Accepted quotes and order records reference immutable historical facts.
- Copying configuration creates an independent copy, not shared mutable state.
- Requested publication state and effective publication state are distinct and must never be conflated.

Admin capabilities already substantially implemented before the current checkpoint include:
- embedded shell
- product picker/editor
- Preact + Polaris UI
- shared Konva visualizer
- UI↔canvas geometry synchronization
- draft save/versioning
- stale-edit/CAS conflict handling
- ambiguous-save recovery contracts
- publish request/activation state rendering
- authorization-loss private-state clearing
- refresh/recovery handling
- mobile/two-tab controls
- publication state observation and v3 integration.

## 5. Customization grouping and pricing

### Grouping

A customization group represents compatible real product variants sharing the same production customization design/revision.

- compatible size/color variants can aggregate into one group
- a different design/customization is a different group/cart line grouping as applicable
- setup is charged once per customization group.

### Pricing model

Supports:
- general setup fee
- decoration-method setup/unit components
- placement setup/unit components
- scoped customization components
- tiered quantity pricing
- total customized physical order quantity generally drives tiers
- plain/non-customized quantity is excluded
- allocation must be deterministic.

Example concept: a general setup fee of 20 plus quantity × method/placement customization price.

### Economics

- Insignia computes customization price itself.
- Buyer purchases merchant's **real variants**.
- Avoid customer-visible synthetic fee products/fee lines if platform mechanism allows.
- Accepted customized merchandise price is pre-discount.
- Shopify discounts apply after.
- Normal tax semantics.
- Garment prices are contextual Shopify prices.
- customization base is shop currency with FX/overrides; accepted presentment values freeze with the quote.
- accepted quote is immutable.

## 6. Shopify cart/checkout mechanism

Architecture isolates platform materialization behind a mechanism boundary.

Locked direction from platform research:
- Plus: line update path
- non-Plus: same-real-variant one-child lineExpand path, qualification-gated
- no paid customization selling plan
- no synthetic fee line unless future platform constraints force reconsideration.

G1–G6 integrated cart/checkout qualification is later M7 work; do not reopen that research in M5 unless a genuinely new platform defect appears.

## 7. Whole-quote authorization v2

Accepted whole-quote protocol is v2:

- Ed25519 installation-scoped signing
- compact binary authorization
- shared quote envelope + member carriers
- complete-set offline verification in Functions
- deterministic allocation
- lifetime: 3 shop-local days
- domain separation `Insignia\0WholeQuoteAuthorization\0v2\0`
- magic `ISG2`
- version 2 / flags0
- 92-byte header
- 22-byte member
- cart properties `_insignia_quote_v2` and `_insignia_member_v2`

Current engineering guards:
- 32 buckets
- 200 lines
- 10,000 physical quantity
- 16,000 output

These are implementation guards, not commercial plan capacity promises. Full stack peak remains a later capacity/release concern.

## 8. Required-product publication policy

Option A is locked:
- trust correctly published/access-controlled app-owned policy plus Function inputs under the supported publication contract
- buyer markers are not authority
- reject missing/invalid authoritative evidence where detectable
- if supported publication evidence disappears coherently outside app control, a formerly-required product could become an unsigned plain purchase; that residual is an accepted incident class, not a reason to trust buyer markers
- unsafe app-owned publication defects are app incidents.

## 9. Availability Hold v3

v3 is accepted and should not be redesigned casually.

History:
- v1/v2 exact history preserved
- new FIRST_PUBLICATION/MODE_CHANGE uses v3
- SAME_MODE does not hold
- v3 captures exact currently-effective Publication IDs and direct anchors
- every effective Publication is directly verified
- DRAFT held-safe means zero effective visibility plus original anchors still include product
- restore requires exact original effective set/online-store semantics/anchors
- one-shot DRAFT compensation only for a settled restore that semantically mismatches
- ambiguous restore is never blindly compensated.

PR #48 corrected provider completion timing to response `receivedAt`, not request-start `observedAt`. Availability v3 then became accepted; no additional availability-specific live qualification is expected unless a new integration defect appears.

## 10. Artwork

M6 is the next implementation milestone after M5 closes.

Locked artwork rules:
- private exact originals: SVG/PNG/JPEG
- safe generated previews: PNG/WebP
- do not embed arbitrary inline SVG in buyer/admin surfaces
- replacements append; they do not mutate historical originals
- state: `PENDING_ARTWORK → READY → ARTWORK_LOCKED`
- buyer-identifying artwork retention max six months; abandoned work shorter; reuse does not reset retention.

## 11. Billing / entitlements

Product direction:
- three feature-differentiated plans
- subscription plus per-order usage
- plan allowances
- one qualifying paid order → one usage event
- 14-day trial on chosen plan
- inactive entitlement stops new issue/renew but accepted work remains honored
- downgrade that makes a config incompatible stops new quoting.

Commercial **values** remain intentionally owner-controlled:
- actual plan handles
- actual usage meter handles
- prices
- policy IDs
- feature mapping
- included usage
- Partner credentials/configuration.

Do not infer these from tests or invent them to unblock M5.

The application has a versioned entitlement projection contract that reads current Shopify App Pricing/Partner subscription state and maps it through owner-defined policy. It fails closed for stale/unrecognized/malformed state.

## 12. Privacy / retention

- buyer-identifying artwork max six months
- abandoned content shorter
- reuse does not reset retention age
- privacy/uninstall removes identifying payloads and derivatives
- economic/order facts may remain where needed
- pseudonymized audit may persist.

## 13. Production host / identity

Current owner lock supersedes prior `.com` and earlier `.nl` candidates:

- name: `Insignia`
- canonical origin: `https://insignia-app.optidigi.nl`
- embedded admin: `https://insignia-app.optidigi.nl/admin/products`
- `APP_URL=https://insignia-app.optidigi.nl`
- existing Shopify app/client identity remains
- Stitchs and Superfunny are unrelated legacy apps.

The web app is deployed separately from Shopify app-version configuration.

## 14. Shopify version history currently relevant

- Active: `1158986629121 / m5-019r-9b94149272d1`
- rollback: `1153019904001 / insignia-3`
- `1158837927937 / m5-019-a9717e1265ef`: permanent NEVER_RELEASE

The active version was released exactly once in M5-020. Do not re-release it merely for M5-023 web/runtime work.

## 15. Authentication model

Embedded admin uses App Bridge ID token + server token exchange.

Accepted corrected behavior in PR #53:
- missing/invalid bearer or local invalid identity → 401
- refreshable token-exchange rejection → typed `ONLINE_EXCHANGE_REFRESH_REQUIRED`
- HTTP boundary returns 401 + `X-Shopify-Retry-Invalid-Session-Request: 1`
- browser asks App Bridge for a new ID token and retries at most once
- second 401 stops
- 403 does not retry
- generic exchange/provider/database failures remain 503
- safe diagnostics identify bounded stage enums only.

Current historical Search `Authentication unavailable` occurred before this correction was deployed, so its first failing stage remains unknown.

## 16. Managed-install lifecycle — current implementation

PR54 implements provider-authoritative managed-install bootstrap after verified App Bridge ID-token and matching current online-staff grant. It captures exact provider Shop ID/AppInstallation ID/domain/scopes/timezone, transactionally ensures exactly one app-owned tenant and generation for first installation, reuses matching current installation, and requires independently confirmed provider observation and stale-state fences for reinstall. Signed uninstall overlap, uniqueness-winner, generation, staff and session invalidation are locally covered. No manual SQL tenant seed. **This source is not deployed as of the last VPS stop; no live authenticated Search has qualified it.**

## 17. Offline credential lifecycle

The repo already has encrypted expiring-offline credential infrastructure:
- application validation/refresh lifecycle
- database encrypted envelopes
- generation/version/claim fences
- worker refresh path.

M5-023 must inventory actual background consumers. If persistent/background Admin GraphQL access is required, bootstrap the Shopify expiring offline access+refresh pair through that existing lifecycle. Do not create a new token store or use offline tokens as a substitute for staff authorization.

## 18. Trusted release/readiness model

PR #53 introduces/qualifies:
- append-only `trusted_release_records`
- operator-owned evidence
- runtime SELECT-only read seam
- exact shop/install/app/current-version binding
- expected Function build stored independently
- current Function ownership observation
- exact evidence digest
- trusted release attestation
- accepted Active version bound by runtime
- exact 30-second observation freshness
- synchronous merchant-local day from authenticated IANA timezone.

Important:
- stored evidence is never restamped on read
- expired/stale/future/wrong-version/latest-invalid evidence fails closed
- newer global Active evidence prevents older version fallback
- reinstall/deactivation invalidates scope
- missing record/Function mismatch leaves activation waiting and effective pointer null.

Migration16 now refuses down migration while any trusted record exists; normal production rollback is web rollback preserving DB evidence.

## 19. Latest production observation — M5-023 stopped

The first owner-authorized read-only lifecycle qualification after full preproduction freeze found no matching worker candidates in observed running Docker topology and no pg-boss schema in the designated PostgreSQL18 database. Webhook-secret parity and effective candidate/runtime configuration parity were also unqualified; root causes of parity failure were not recorded. DBA identity and required application privileges qualified. Worker-specific probes were NOT_RUN rather than observed failing. Existing web remains the old M5-019 image and healthy. No backup/migration16/role provisioning/worker or web deployment/owner Search/provider operation/trusted append/fixture happened. Access was revoked and the local key removed. **`BLOCKED_UNINSTALL_PROCESSOR_READINESS`**, not commercial-only or live authentication PASS.

## 20. G7 status

`M5_G7_NOT_PASSED`. The 34-criterion matrix preserves six historically accepted source-contract controls and 28 blocked native criteria. There was no M5-023 native Search, authenticated tenant/staff/install verification, current Function/signing/trusted-release/calendar observation, legitimate commercial entitlement, publication fixture or cleanup. Historical Active Shopify version `1158986629121` is not a fresh read or per-store equality proof. Actual future merchant flow remains blocked pending durable uninstall/queue prerequisites and separately authorized web/schema steps.

## 21. Milestone map

- M0 platform proofs — complete
- M1 workspace/boundaries — complete
- M2 domain/economics — complete
- M3 persistence/install/delivery — implemented but M5-023 found first-session production integration missing; fix now
- M4 pricing/authorization/entitlement — complete contracts
- M5 admin ProductConfig + visualizer/publication/G7 — current milestone, open
- M6 artwork — next after M5
- M7 storefront quote/cart — later
- M8 order snapshots/artwork/refunds — later
- M9 usage billing/G8 — later
- M10 security/recovery/release qualification — later
- M11 controlled production release — later.

## 22. Current successor safety perimeter

Do not reopen M5-023 as if unimplemented, reset PR54 to the old snapshot, manually seed tenants, change canonical Shopify app/version/scopes, invent owner commercial handles or entitlement, weaken trusted-release freshness, bypass human verification, release/rollback versions, rewrite Availability v3/v1/v2 semantics, or begin M6/M7. M5-024 begins only after exact approved PR54 normal merge. Its first authorized phase is **offline** prerequisite work; no host/provider/credential/database/live deployment authority travels with this handoff.
