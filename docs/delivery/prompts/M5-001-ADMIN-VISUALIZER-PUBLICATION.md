# M5-001 — merchant configuration editor, shared visualizer and publication workflow

## Status

Authorized only after the exact approved normal merge of PR #26.

This is the first M5 slice.

It creates the real merchant configuration workflow and reusable visualizer,
but it must preserve the M4 fail-closed activation boundary.

M5 is **not complete** merely because this PR lands.

## Goal

A merchant can, inside the embedded app:

1. choose a Shopify product;
2. create/open its one ProductConfig;
3. edit a validated mutable draft;
4. configure production placements/methods/steps/pricing;
5. see a synchronized visual preview;
6. save with optimistic conflict handling;
7. create an immutable revision and request publication;
8. observe truthful publication states such as
   `REMOTE_READY_ACTIVATION_PENDING`, `CONFLICT` or `OPERATOR_HOLD`.

The UI must never display a revision as active merely because Shopify Admin
readback succeeded.

## 1. Product-config admin surface

Build production admin routes/pages in `apps/web`.

Use Astro SSR plus page-local Preact islands and Polaris Web Components.

Suggested route shape:

```text
/admin/products
/admin/products/[productId]/config
```

Exact file names are implementation detail.

### Product picker/list

Use a bounded read-only Shopify product adapter to display enough merchant
catalog context to identify a product:
- Product ID;
- title;
- status;
- representative image/media when available;
- variants needed to understand size/color vectors.

Do not query every product/variant eagerly.

Use pagination/search.

No Shopify product mutation is needed in this slice.

### ProductConfig invariant

Enforce the existing rule:

> one ProductConfig per `(shop, Shopify product)`.

Opening a product:
- loads the existing draft/config if present;
- otherwise offers explicit creation;
- never silently aliases another product's config.

## 2. Draft editor

The editor must operate on the production M2 versioned configuration schema.

Cover at least the locked merchant-configurable semantics already represented
by the domain:

- required vs optional customization mode;
- decoration methods;
- placements;
- decoration size/step options;
- placement ↔ method/step compatibility;
- logo-later permission;
- general setup pricing;
- method setup/unit pricing;
- placement setup/unit adjustment pricing;
- size/step setup/unit pricing where supported;
- all-units quantity tier schedules;
- explicit presentment-currency overrides already supported by the schema.

Do not invent commercial plan values.

Do not add an RFQ mode, fee products, variant pools or legacy production admin.

### Validation

Use production domain/contracts for validation.

The server is authoritative.

Browser validation can improve UX but must not be the only enforcement.

Invalid tier schedules, duplicate IDs, invalid money, dangling placement/method
references or unsupported schema versions must not save.

## 3. Geometry / visualizer contract

Create the production `packages/visualizer` package.

Architecture:
- pure deterministic geometry/scene projection is browser-safe;
- direct Konva is the renderer;
- no React and no `react-konva`;
- application/config state remains the source of truth;
- Konva nodes are a projection, never authoritative business state.

### Geometry source

Inspect the legacy storefront repository strictly as a visual/interaction
reference.

Add the **minimal versioned geometry representation necessary to reproduce the
actual reference behavior**.

Do not copy legacy backend models.

Prefer normalized product-image coordinates so the same geometry survives
responsive rendering.

If the legacy reference materially requires non-rectangular masks, clipping or
other geometry beyond the existing M2 configuration model, implement a narrow
versioned pure representation if straightforward. If doing so would change
locked production semantics, stop and return the exact gap to the principal.

### Required scene behavior

At minimum support:
- one or more product views/images;
- visible placement regions;
- selected placement highlight;
- selected decoration size/step projection;
- artwork/logo-later placeholder projection;
- variant/color image switch;
- responsive contain/fit;
- deterministic coordinates independent of device pixel ratio.

No artwork upload/inspection is implemented here; M6 supplies real artwork.

Use safe synthetic preview assets/placeholders in tests.

## 4. UI ↔ canvas synchronization

Prove both directions where the editor supports direct manipulation.

Examples:
- choosing placement/step in Polaris controls updates Konva immediately;
- selecting/moving/resizing a permitted placement in canvas updates the draft
  form/model;
- changing product view/variant swaps the background while keeping the correct
  normalized geometry;
- undoing/reloading reads from draft state rather than stale Konva node state.

All geometry mutations pass through typed application/editor state.

No two independent state stores.

## 5. Draft CAS / save recovery

Use the existing M3 optimistic draft version.

A save command requires:
- authenticated shop/staff context;
- exact ProductConfig/shop/product identity;
- prior `draft_version`;
- validated versioned draft.

Required UX:
- clean/dirty state;
- saving state;
- saved confirmation;
- explicit conflict on stale version;
- reload/review latest rather than overwriting;
- retry-safe request/idempotency behavior;
- network/ambiguous response recovery by re-reading the actual current version.

Do not implement "last writer wins".

## 6. Copy-to-product

Implement the locked independent-copy behavior.

Merchant may copy a source config/draft to a different product.

The target:
- receives a new ProductConfig identity;
- is independently editable afterward;
- does not create synchronized cross-product configuration;
- gets new internal IDs where identity collision would be ambiguous;
- never copies an effective publication pointer or accepted quote.

Copy is a normal authenticated command with idempotency and target-product
ownership checks.

## 7. Publish command

Implement the merchant command over the existing durable M3/M4 path.

A publish request:
1. validates the current draft;
2. checks entitlement/config-feature eligibility;
3. creates an immutable revision through existing trusted persistence;
4. calls the production M4 publication `prepare`;
5. drives or schedules the bounded publication state machine;
6. exposes the durable resulting state to the UI.

Do not let the browser supply remote projection JSON/digests.

Do not call M3 `activate()` directly.

### UI state names

The UI must distinguish at least:

```text
DRAFT
PUBLISH_REQUESTED
REMOTE_PENDING
REMOTE_READY_ACTIVATION_PENDING
ACTIVE
CONFLICT
OPERATOR_HOLD
```

Names may vary, but do not collapse "remote ready" into "published/active".

For this slice, production composition may remain
`REMOTE_READY_ACTIVATION_PENDING` because the reviewed activation adapter is
not yet available.

## 8. Activation boundary

Do not fake an admission/availability implementation.

M5-001 should define the merchant-facing shape for the later activation
workflow, including:
- why activation is pending;
- whether first publication or a policy mode change requires an all-channel
  hold;
- current Function readiness status;
- operator/conflict state where applicable.

Do not archive/publish/unpublish merchant products automatically.

Do not disable sales channels as an implementation shortcut in this PR.

A separate principal-authorized M5 activation slice will own any real commerce
availability mutation or Function artifact attestation.

## 9. G7 admin hardening

M5 owns the remaining embedded-admin criteria before the admin feature is
accepted.

Implement and test the concrete admin pages with the existing auth boundary.

Required coverage includes:

### Server/auth

- cold embedded launch;
- deep link;
- page reload;
- exact shop/install binding;
- staff authorization for read vs mutation;
- expired identity/session token;
- private SSR/data fragments never served unauthenticated;
- mutation request cannot be replayed cross-shop;
- CSRF/origin/session-token controls appropriate to the current embedded
  transport;
- grant/permission cache invalidation on reinstall/deactivation.

### Browser

- Polaris custom elements actually upgraded;
- Preact island hydration;
- no React dependency;
- mobile viewport;
- browser with third-party cookies blocked where applicable to the chosen auth
  model;
- concurrent token refresh;
- ambiguous draft-save recovery;
- deep navigation without private-data flash.

Use the existing M1 real-Polaris negative-control strategy; do not replace it
with clickable unknown tags.

## 10. Entitlement behavior

Do not invent production plans.

The admin UI consumes configured feature-policy IDs.

Required behavior:
- missing/stale/unrecognized entitlement blocks publish where the feature is
  required;
- existing drafts remain viewable/editable where product policy allows;
- no entitlement does not mutate an already active historical revision;
- pending future App Pricing update does not grant features early;
- scheduled cancellation retains current features until the provider contract
  actually ends.

Development tests use synthetic plan policy.

The retained zero-dollar development handle remains evidence/config only, not
hard-coded commercial policy.

## 11. Product images and visual safety

Admin preview may display Shopify-hosted product images through normal browser
image loading.

Do not proxy arbitrary merchant HTML.

Do not accept arbitrary SVG markup from browser config.

Real buyer/merchant artwork upload and SVG sanitization are M6.

Synthetic editor artwork placeholders must not become persistent production
artwork authority.

## 12. Legacy visual-reference capture

In parallel with admin implementation, create a bounded non-identifying visual
reference pack from `Optidigi/insignia-legacy`.

Capture only storefront states useful later for M7 visual parity, for example:
- initial customizer;
- placement selection;
- method/step selection;
- quantity/review state;
- mobile layout if available.

Do not port legacy backend/API code.

Do not include real customer artwork or data.

Record source commit/file provenance.

If the legacy app cannot run without unavailable production dependencies, use
source/CSS/component inspection plus synthetic reconstruction and disclose that
the screenshot is reconstructed.

## 13. Browser/package boundaries

Add dependency rules so:
- `packages/visualizer` can be used by admin browser islands and later
  storefront;
- visualizer cannot import database/shopify/server/auth/observability;
- domain does not import visualizer/Konva;
- server-only config/publication code cannot enter browser bundles;
- Konva is present only in the renderer/visualizer layer.

Use exact pinned Konva dependency after current compatibility research.

No React/react-konva.

## 14. Tests

### Geometry / visualizer

- normalized ↔ rendered coordinate roundtrip;
- contain/fit under multiple viewport sizes/DPRs;
- placement selection and step size;
- view/variant switch;
- deterministic scene projection;
- invalid/out-of-bounds geometry rejection or clamping per explicit contract;
- canvas→UI and UI→canvas synchronization;
- no renderer state drift after rerender.

### Config/editor

- create config;
- one-config-per-product conflict;
- invalid draft;
- optimistic save success;
- stale save conflict;
- ambiguous save recovery;
- copy to product creates independent config;
- publish creates immutable revision;
- draft edits after publish do not mutate revision;
- publication state renders activation-pending distinctly;
- missing entitlement blocks publish;
- required/optional mode represented correctly.

### Admin/browser

- cold/deep/reload;
- unauthorized/private data;
- staff mutation denial;
- expired token;
- cookie-blocked/mobile;
- Polaris real component upgrade;
- Preact interaction;
- concurrent refresh;
- draft conflict UX;
- no private state in initial unauthenticated HTML.

### Regression

Run the complete existing M1–M4 root suite, PostgreSQL, Rust/Function,
publication/history, storefront and secret/boundary checks.

## 15. Local/server integration

Use real PostgreSQL 18 for editor/config/publish integration tests.

For synthetic publication tests:
- use the production M4 publication coordinator;
- use a fake Admin remote;
- prove remote-ready remains activation-pending without admission;
- prove conflict/operator hold appears in admin read model.

Do not replace the M4 state machine with UI-only status.

## 16. Optional bounded embedded live proof

After local tests and fresh reviews, one serialized operator may run **one
web-only development preview** using the designated Public/Draft app/store.

The live proof is for:
- embedded authentication;
- Product read/list/detail;
- cold launch/deep link/reload;
- real Polaris/Preact editor shell;
- one local-database draft create/save/conflict/reload flow if the preview's
  disposable DB is clearly isolated.

Use only:
- app `429028933633`;
- `insignia-rewrite-dev.myshopify.com`;
- retained archived product `gid://shopify/Product/10485042479387`.

### External ceiling

- at most 20 Admin GraphQL **reads**;
- at most 2 necessary existing-scope Admin auth exchanges;
- no Admin GraphQL mutation;
- no Partner API call;
- no App Events token/event;
- no Shopify metafield write;
- no Function deployment;
- no product/Market/inventory/cart/order mutation.

A web-only preview is permitted only if the CLI can avoid changing Functions,
theme extensions or scopes. If not, skip the live preview and report the
limitation rather than broadening the authorization.

Do not read owner credential files beyond the existing server auth mechanism
needed by the approved preview. Never print/export session or bearer material.

Stop the preview and retain only sanitized evidence.

## 17. Work split

Use actual `sol-6-high`.

Up to two non-overlapping restricted writers:

### Writer A — visualizer/geometry

Own:
- pure scene/geometry contract;
- `packages/visualizer`;
- direct Konva renderer;
- geometry/renderer tests;
- legacy visual-reference extraction.

Do not own root lockfile/shared exports.

### Writer B — admin ProductConfig

Own:
- admin pages/islands;
- draft command/read model;
- copy-to-product;
- publication status UI;
- focused browser/server tests.

Do not own root lockfile/migrations/shared publication code.

### Integrator

Own:
- any narrow schema migration;
- package exports/root lockfile;
- Shopify catalog read adapter;
- publication command integration;
- entitlement wiring;
- G7 cross-surface tests;
- CI/boundary rules;
- optional live operator;
- review corrections.

## 18. Fresh reviews

Run fresh read-only:
- Spec/correctness review;
- Standards/security review.

They must review the integrated source, not only screenshots.

Material findings are fixed and rereviewed on the actual corrected source.

## 19. Explicitly out of scope

Do not implement:
- real artwork upload/inspection/R2;
- storefront buyer customizer;
- cart/checkout;
- order purchase snapshots;
- App Events billing;
- production FX activation;
- production signing-key activation;
- Function deployment;
- real Option A commerce hold/activation;
- product availability changes;
- commercial plan creation;
- M6/M7.

## 20. Acceptance for M5-001

M5-001 is principal-reviewable when:

1. merchant can create/open/edit/save one ProductConfig per product;
2. production draft CAS and conflict recovery work through real PostgreSQL;
3. config validation uses M2 production contracts;
4. direct-Konva visualizer uses one state source and deterministic normalized
   geometry;
5. UI and canvas stay synchronized;
6. copy-to-product creates an independent config;
7. publish creates an immutable revision and invokes the production M4
   publication seam;
8. activation-pending/conflict/operator-hold are represented truthfully;
9. no UI path bypasses publication/readiness state;
10. required G7 local/browser behaviors are exercised without private-data
    leakage;
11. legacy storefront reference material is captured without legacy backend
    coupling or customer data;
12. complete existing CI remains green;
13. fresh reviewers report no unresolved material issue.

This is not M5 milestone acceptance.

M5 still requires the separately reviewed activation/admission boundary and
remaining live G7 criteria before merchant publication is accepted.

## 21. Stop conditions

Return for principal direction if:
- legacy storefront requires a materially different geometry model than the
  current configuration can support;
- Polaris/Preact/Astro shows a fundamental incompatibility rather than an
  ordinary integration defect;
- safe admin publication requires a Shopify commerce mutation;
- the M4 activation state must be bypassed to make the UI look successful;
- a new scope is required;
- ProductConfig semantics conflict with M2.

Ordinary UI, geometry, auth, CAS and local browser defects remain in scope.

## 22. Handoff

Return one integrated PR with:
- exact base/head/effective merge base;
- package/geometry schema changes;
- visualizer scene examples/screenshots;
- config editor command/read model;
- PostgreSQL CAS/copy/publish results;
- publication-state examples;
- G7 browser/server matrix;
- legacy visual-reference provenance;
- optional external read/preview register;
- complete final-head CI;
- reviewer dispositions;
- explicit remaining M5 activation/G7 blockers.

Stop for principal review.

No PR merge, M5 activation slice, M6, production policy activation, Function
deployment, production key/FX activation or launch is authorized.
