 # Insignia docs — agent entry
 
 This repo is the documentation source of truth for the Insignia app (storefront modal, admin dashboard, backend services, and asset processing). Canonical contracts and invariants live in `docs/core/`; use those first and treat everything else as supporting context.
 
 ## Where canonical docs live
 
 - Tier 1 canonical docs: `docs/core/`
 - API contracts: `docs/core/api-contracts/`
 - Pricing invariants: `docs/core/variant-pool/`
 
 ## How tiers work
 
 - **Tier 1 (canonical)**: definitive contracts/invariants; implement exactly.
 - **Tier 2 (working)**: useful specs, but incomplete or narrow; defer to Tier 1.
 - **Tier 3 (notes)**: rough drafts/research; do not derive contracts from these.
 
 ## Start here (Tier 1, by topic)
 
 **Architecture & stack**
 - [`docs/core/architecture.md`](core/architecture.md)
 - [`docs/core/tech-stack.md`](core/tech-stack.md)
 
 **Security & verification**
 - [`docs/core/auth.md`](core/auth.md)
 - [`docs/core/svg-upload-safety.md`](core/svg-upload-safety.md)
 
 **Data & contracts**
 - [`docs/core/data-schemas.md`](core/data-schemas.md)
 - [`docs/core/placement-editor.md`](core/placement-editor.md)
 - [`docs/core/storefront-config.md`](core/storefront-config.md)
 - [`docs/core/geometry-snapshot-specification.md`](core/geometry-snapshot-specification.md)
 
 **API contracts**
 - [`docs/core/api-contracts/admin.md`](core/api-contracts/admin.md)
 - [`docs/core/api-contracts/storefront.md`](core/api-contracts/storefront.md)
 - [`docs/core/api-contracts/webhooks.md`](core/api-contracts/webhooks.md)
 
 **Pricing (non‑Plus)**
 - [`docs/core/variant-pool/overview.md`](core/variant-pool/overview.md)
 - [`docs/core/variant-pool/implementation.md`](core/variant-pool/implementation.md)
 
 ## Tier 2 (working specs)
 
 **Admin dashboard**
 - [`docs/admin/README.md`](admin/README.md)
 - [`docs/admin/dashboard-spec.md`](admin/dashboard-spec.md)
 - [`docs/admin/product-configuration.md`](admin/product-configuration.md)
 - [`docs/admin/orders-workflow.md`](admin/orders-workflow.md)
 - [`docs/admin/order-detail-rendering.md`](admin/order-detail-rendering.md)
 
 **Storefront**
 - [`docs/storefront/README.md`](storefront/README.md)
 - [`docs/storefront/modal-spec.md`](storefront/modal-spec.md)
 - [`docs/storefront/rendering-pipeline.md`](storefront/rendering-pipeline.md)
 - [`docs/storefront/integration-guide.md`](storefront/integration-guide.md)
 
 **Backend**
 - [`docs/backend/README.md`](backend/README.md)
 
 ## Notes & research (Tier 3)
 
 **Open work & audits**
 - [`docs/notes/open-work.md`](notes/open-work.md)
 - [`docs/notes/docs-audit.md`](notes/docs-audit.md)
 
 **Design intent (UI only)**
 - [`docs/notes/design-intent/dashboard-ui.md`](notes/design-intent/dashboard-ui.md)
 - [`docs/notes/design-intent/storefront-modal.md`](notes/design-intent/storefront-modal.md)
 
 **Research**
 - [`docs/notes/research/agentic-workflow-research.md`](notes/research/agentic-workflow-research.md)
 
 ## Conflict policy
 
 - Tier 1 overrides Tier 2 overrides Tier 3.
 - If two docs at the same tier conflict, prefer the newest reviewed date if present.
 - If still unresolved, flag the conflict in `docs/notes/open-work.md` and avoid guessing.
 
 ## How to use these docs as an agent
 
 - Start with Tier 1 contracts; link out to Tier 2 only for workflow details.
 - Never infer contracts from Tier 3 notes.
 - Use `docs/DOC_CATALOG.md` to confirm tiers, tags, and paths.
 - When a contract is missing, update `docs/notes/open-work.md` rather than inventing.
