# Documentation Catalog

> **Last updated**: 2026-04-23
> **Purpose**: Inventory of all docs with tiering. Start at `AGENT_ENTRY.md` for navigation.

## Tier 1 — Canonical Contracts (source of truth)

| Path | Tags | Purpose |
|------|------|---------|
| `docs/core/architecture.md` | architecture, system-map | System components and trust boundaries |
| `docs/core/tech-stack.md` | tech-stack, decisions | Canonical stack decisions |
| `docs/core/auth.md` | auth, security | Auth and verification rules |
| `docs/core/data-schemas.md` | data-model, schemas | Shared data shapes and invariants |
| `docs/core/placement-editor.md` | geometry, contracts | Saved output contract for editor |
| `docs/core/storefront-config.md` | storefront, config | Storefront config response shape |
| `docs/core/svg-upload-safety.md` | security, svg | SVG safety policy |
| `docs/core/geometry-snapshot-specification.md` | orders, geometry | Snapshot spec for order accuracy |
| `docs/core/api-contracts/admin.md` | api, admin | Admin API contract (real routes) |
| `docs/core/api-contracts/storefront.md` | api, storefront | Storefront API contract |
| `docs/core/api-contracts/webhooks.md` | api, webhooks | Webhook contract |
| `docs/core/variant-pool/overview.md` | pricing, variant-pool | Non-Plus pricing invariants |
| `docs/core/variant-pool/implementation.md` | pricing, implementation | Variant pool implementation |

## Tier 2 — Working Specs (consult for feature context)

| Path | Tags | Purpose |
|------|------|---------|
| `docs/AGENT_ENTRY.md` | meta, entrypoint | Single starting point for agents |
| `docs/DOC_CATALOG.md` | meta, catalog | This file |
| `docs/MAINTENANCE.md` | meta, maintenance | Maintenance and link-check guide |
| `docs/RUN_APP_TEST_STORE.md` | meta, testing | How to run and test the app |
| `docs/admin/README.md` | admin, navigation | Admin folder index |
| `docs/admin/dashboard-spec.md` | admin, dashboard | Dashboard functional spec |
| `docs/admin/order-detail-rendering.md` | admin, rendering | Order detail rendering spec |
| `docs/admin/orders-workflow.md` | admin, orders | Merchant order workflow (incl. WC migration note) |
| `docs/admin/product-configuration.md` | admin, product-config | Product config workflow |
| `docs/backend/README.md` | backend, setup | Backend setup and ops |
| `docs/frontend/backend-api-reference.md` | api, admin, order-block | Comprehensive admin API + order block reference (audited 2026-04-22) |
| `docs/ops/cron-setup.md` | ops, cron | Cron job setup for variant slot + draft cleanup |
| `docs/ops/multi-instance-deployment.md` | ops, deployment | Multi-instance VPS deployment guide |
| `docs/storefront/README.md` | storefront, navigation | Storefront folder index |
| `docs/storefront/modal-spec.md` | storefront, modal | Storefront modal UX spec |
| `docs/storefront/rendering-pipeline.md` | storefront, rendering | Rendering pipeline rules |
| `docs/storefront/integration-guide.md` | storefront, integration | Backend integration guide |
| `docs/storefront/testing.md` | storefront, testing | Storefront testing guide |

## Tier 3 — Notes (consult, don't treat as contracts)

| Path | Tags | Purpose |
|------|------|---------|
| `docs/notes/open-work.md` | planning, decisions | Open questions and decisions to revisit |
| `docs/notes/polaris-quirks.md` | ui, polaris | Known Polaris v13 layout bugs and workarounds (React only; WC pages exempt) |

## Superpowers — Active Specs

| Path | Status | Purpose |
|------|--------|---------|
| `docs/superpowers/specs/2026-04-10-v3-future-features.md` | ACTIVE | V3 feature backlog (ruler tool, 3D preview, etc.) |
