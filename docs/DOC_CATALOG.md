# Documentation Catalog

> **Last updated**: 2026-04-14
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
| `docs/core/api-contracts/admin.md` | api, admin | Admin API contract |
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
| `docs/admin/orders-workflow.md` | admin, orders | Merchant order workflow |
| `docs/admin/product-configuration.md` | admin, product-config | Product config workflow |
| `docs/backend/README.md` | backend, setup | Backend setup and ops |
| `docs/backend/r2-cors.md` | backend, cors | R2 CORS configuration |
| `docs/storefront/README.md` | storefront, navigation | Storefront folder index |
| `docs/storefront/modal-spec.md` | storefront, modal | Storefront modal UX spec |
| `docs/storefront/rendering-pipeline.md` | storefront, rendering | Rendering pipeline rules |
| `docs/storefront/integration-guide.md` | storefront, integration | Backend integration guide |
| `docs/storefront/testing.md` | storefront, testing | Storefront testing guide |

## Tier 3 — Reference & Planning (consult, don't treat as contracts)

| Path | Tags | Purpose |
|------|------|---------|
| `docs/notes/open-work.md` | planning, decisions | Open questions and decisions to revisit |
| `docs/notes/design-intent/dashboard-ui.md` | ui, design-intent | Dashboard UI design thinking |
| `docs/notes/design-intent/storefront-modal.md` | ui, design-intent | Storefront modal design thinking |
| `docs/START_PROMPT.md` | meta, onboarding | Starting prompt for new agents |

## Superpowers — Execution Plans & Specs

| Path | Status | Purpose |
|------|--------|---------|
| `plans/2026-04-06-v2-full-implementation.md` | PARTIALLY EXECUTED | The V2 implementation plan (11 phases, 51 tasks) |
| `plans/2026-04-07-v2-completion.md` | ACTIVE | Gap closure plan — remaining V2 work |
| `plans/2026-04-07-v2-completion-execution-guide.md` | REFERENCE | Methodology for executing gap closure |
| `specs/2026-04-05-insignia-v2-research.md` | REFERENCE | Competitor analysis, personas, feature prioritization |
| `specs/2026-04-05-insignia-v2-user-test-findings.md` | REFERENCE | 5 persona cognitive walkthroughs |
| `specs/2026-04-06-v2-image-upload-workflow.md` | REFERENCE | Image upload workflow design |
| `specs/2026-04-09-v2.1-view-editor-brainstorm.md` | ACTIVE | View Editor rework research + competitor analysis |
| `specs/2026-04-10-v3-future-features.md` | ACTIVE | V3 feature backlog (ruler tool, 3D, etc.) |
| `specs/v2-design-decisions-and-todos.md` | ACTIVE | Consolidated design decisions + open todos |
| `plans/2026-04-13-phase1-hardening.md` | EXECUTED | Phase 1 hardening (cron, rate limiting, CI, tests) |
| `specs/2026-04-13-phase1-hardening-design.md` | EXECUTED | Phase 1 hardening design spec |
