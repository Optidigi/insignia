# Insignia — authoritative decision ledger

Version 1.1 — 24 September 2026. Derived from the approved conversation decisions. Companion: implementation-plan.md. Version 1.1 adds execution governance only; approved product decisions are unchanged. This is a planning record; no development gates have been executed.


### LOCKED

**Authority/scope:** Pasted baseline plus accepted answers, including final inactive/downgrade approval. Greenfield modular monolith. Legacy is a storefront UI/visual reference only. No migration/import concern or implementation work.

**Stack/boundaries:** Strict TypeScript; Node 24 LTS; pnpm + Cargo; Astro 7 Node SSR; Preact admin islands and Vite storefront; Polaris Web Components; Custom Element + Shadow DOM; direct Konva in a shared framework-independent visualizer; Zod 4; PostgreSQL 18 + pg/Kysely; dbmate SQL; pg-boss; private R2; Sharp/libvips; Pino/prom-client; Vitest/Playwright/dependency-cruiser/GitHub Actions. Shopify JS SDK only inside Shopify adapter. Pure domain independent of framework, renderer, platform and persistence.

**Configuration:** One active ProductConfig per product, independent copy, mutable draft, immutable published revisions. New unaccepted pricing uses current permitted publication. Accepted quotes/orders retain historical revisions.

**Pricing/identity:** Product/revision-bound customization groups aggregate compatible size/color variants. Different production design means different group. Merchant-configurable setup and unit components for method/placement/decoration step; general setup supported. Applicable setup charged once per group regardless of quantity or materialization splitting. Method unit multiplicity configurable. All-units customization unit tiers use total customized physical quantity across every group/product; unrelated plain items excluded. Reprice/reaccept complete customized subset on material changes. Exact accepted total after deterministic unit allocation; real variants, no synthetic fee architecture.

**Checkout economics/security:** Customized accepted merchandise price is pre-discount; Shopify discounts act afterward on the whole price, with normal variant tax treatment. Contextual garment prices; shop-currency customization/automatic FX with explicit currency overrides and frozen accepted presentment values. Immutable accepted quotes. Per-shop Ed25519, compact binary/no JWT cart tokens, one token per quote line, offline verification, three shop-local calendar days, bounded reusable complete offer. Renew unchanged economics/context; otherwise review. Independent economic validation, fail closed.

**Materialization/surfaces:** Plus lineUpdate; non-Plus same-real-variant one-child lineExpand is the intended gated mechanism. Online Store one-time purchases and supported accelerated paths. App Proxy for storefront/backend control; direct presigned R2 upload allowed. No paid customization with a selling plan. Required customization means required for all purchases; optional products may offer plain selling-plan purchases.

**Artwork/orders:** Byte-exact private SVG/PNG/JPEG originals, verified before use, safe PNG/WebP previews, no arbitrary inline SVG. Merchant-controlled logo-later; merchant-only post-order attachment. Append-only replacements; PENDING_ARTWORK → READY → ARTWORK_LOCKED. Immutable order-time purchase facts. Shopify owns payment/fulfillment/refunds/returns/restock; no garment/customization refund split.

**Billing/entitlements:** Three feature-differentiated plans, subscription + per-order usage and different included allowances. One qualifying paid order, not quantity/groups; refunds do not reverse usage. Fourteen-day live chosen-plan trial from activation, subscription and usage waived, no retrospective trial billing and no separate demo system. No active entitlement means no new issuance/renewal; valid old offers honored until expiry. Historical order/artwork access remains within retention. Downgrade-incompatible configs stop new quoting until adjusted/republished or entitlement restored. Required purchases do not silently become plain purchases.

**Retention:** Buyer artwork/identifying customization payloads at most six months from collection; abandoned uploads shorter; reuse does not reset expiry; merchant warning/export opportunity. Permitted minimal pseudonymized financial/audit facts may persist separately. Privacy/uninstall erasure includes derivatives/payloads and does not rewrite purchase economics.

**Delivery governance:** ChatGPT in the Insignia Rewrite Project is principal architect/reviewer; sol-6-high is the local orchestrator. Repository documents and SHA-bound PR verdicts preserve continuity. Preflight PF-001 precedes M0. One outcome per slice/PR; one writer by default, at most two independently authorized non-overlapping writers in separate worktrees; local read-only pre-review plus principal review of every PR. User retains merge/resource authority unless explicitly delegated for a reviewed change. No unattended monitoring is assumed. `../delivery/operating-model.md` controls the detailed execution method; later slices require recorded principal authorization.

### DEVELOPMENT GATES

G1 same-variant non-Plus lifecycle; G2 complete Ed25519/Wasm/resource capacity; G3 TS/Rust golden vectors and transport; G4 discounts/Markets/tax/accelerated behavior; G5 setup allocation/exact decimal serialization; G6 independent fail-closed enforcement plus cart repair; G7 embedded Astro authentication/Polaris/Preact; G8 hybrid billing/trial/allowance/plan-change/delivery lifecycle.

**Current state: every gate NOT RUN.** This plan authorizes proceeding to gated implementation, not declaring those platform hypotheses proven.

### DEFERRED

Actual production/VPS topology, deployment procedure, Barman/R2 restore mechanics, host-specific alert thresholds and other host operations until M11. Exact FX provider/cadence remains an implementation-time selection under the defined reproducibility/freshness contract. Plan names/prices/allowance values and feature-to-plan matrix remain commercial configuration required before the corresponding paid release, not guessed by coding agents. Migration/import is **excluded from this implementation**, not a hidden later milestone.
