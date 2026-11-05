# Merchant admin capabilities and required controls

Research date: 20 October 2026. Source: `codex/ui-redesign`, commit `1a18b463631ef162cdb577a8a4268500630a7e82`, based on fetched `origin/main` at `54c222ba8e4481b4c50be4522f9ab7686fb49d67`. Remote main remained at that ref during this investigation.

The owner rejects the current admin design. This inventory uses the implementation to establish behavior, data, contracts and gaps. Current layouts, visual hierarchy, wording and navigation are not design references or limits on the redesign. Suggested controls below describe merchant tasks, not a proposed page layout or an approved expansion of product scope.

Read this report for the merchant task map, the [product-control inventory](admin-product-controls-2026-10-20.md) for detailed editor fields and recovery states, and the [API inventory](admin-api-inventory-2026-10-20.md) for exact methods, payloads, permissions and side effects. Those appendices cite the implementation rather than treating specification prose as evidence of completed behavior.

## What the admin is for

The merchant configures how a real Shopify product can be customized, publishes an eligible configuration, then retrieves trustworthy purchased designs and production artwork. Supporting tasks are reusable decoration-method naming, theme setup, subscription management and privacy-request exports. Shopify owns catalog records, garment variants, payments, fulfillment, cancellations, refunds and inventory. [Current specification](../../architecture/implementation-plan.md#72-screens-and-use-cases)

This is a merchant application inside Shopify Admin. It is not currently a platform-wide operator console or a fulfillment/ERP product. The implemented navigation declares Products, Orders and Settings; Home points to Products rather than a separate dashboard. [Navigation source](../../../apps/web/src/components/AdminNavigation.astro#L1)

## Current entry points

There are nine merchant task page patterns, one unavailable/recovery page and two redirects under `/admin`. These are file-route patterns; a product or purchase identifier creates a resource page rather than a new feature. `/` redirects to Products and retains its query string. [Entry redirect](../../../apps/web/src/pages/index.astro#L1), [page source directory](../../../apps/web/src/pages/admin)

| Task | Current route | What the implementation exposes |
| --- | --- | --- |
| Find a product | `/admin/products` | Shopify catalog search and pagination, product title/image/status and entry to a product's configuration. |
| Configure a product | `/admin/products/:productId/config` | Create/read a draft; product-local methods, placements, images, geometry, decoration sizes, production choices, prices, preview, save/discard, copy and publication/recovery. |
| Find a customized order | `/admin/orders` | Recorded Insignia purchases, dates, artwork status and exact original total; load older orders; filter artwork status within loaded results. |
| Prepare production artwork | `/admin/orders/:purchaseId` | Purchase facts, variant quantities/prices, historical design preview, placement artwork, originals, replacements, lock, attachment history and Shopify reconciliation. |
| Find app settings | `/admin/settings` | Links to the four settings tasks below and an explicit permissions/readiness check. |
| Maintain method names | `/admin/settings/methods` | Create, rename and remove reusable method templates. |
| Connect the storefront | `/admin/settings/storefront` | Configuration guidance and conditional Shopify theme-editor links for the customization block and cart-repair embed. |
| Understand subscription access | `/admin/settings/billing` | Authoritative subscription observation, trial/cycle/cancellation/pending-change information, refresh and a Shopify billing-management link. |
| Respond to a privacy request | `/admin/settings/privacy` | Request list, manifest, retained order/design JSON exports and links to authorized original artwork. |
| Recover configuration failure | `/admin/unavailable` | Safe public recovery message and return-to-Shopify action, with HTTP 503. |
| Redirect existing URLs | `/admin/billing`, `/admin/privacy` | HTTP 302 to the corresponding settings page; no additional feature. |

The [product appendix](admin-product-controls-2026-10-20.md) traces the first, second and method-library rows. Other rows are directly implemented in [PurchaseArtwork](../../../apps/web/src/islands/PurchaseArtwork.tsx#L299), [MerchantSettings](../../../apps/web/src/islands/MerchantSettings.tsx#L7), [StorefrontSetup](../../../apps/web/src/islands/StorefrontSetup.tsx#L4), [MerchantBilling](../../../apps/web/src/islands/MerchantBilling.tsx#L12), [MerchantPrivacy](../../../apps/web/src/islands/MerchantPrivacy.tsx#L25), [unavailable](../../../apps/web/src/pages/admin/unavailable.astro#L1) and the [billing](../../../apps/web/src/pages/admin/billing.astro#L1)/[privacy](../../../apps/web/src/pages/admin/privacy.astro#L1) redirects.

## Controls the redesigned UI needs to account for

This is the functional brief to preserve or improve. It does not require keeping the current step sequence, sidebars, disclosures, tables or component arrangement.

| Merchant task | Controls and information needed | Current support or gap |
| --- | --- | --- |
| Select a real product | Search, meaningful product identification, status, pagination, enter configuration. Explain when the returned variant list is incomplete. | Existing catalog API and picker. Current pagination and truncation behavior are in the product appendix. There is no Insignia catalog-creation workflow. |
| Define customization policy | Optional/required customization, available decoration methods and placements, allowed method/size combinations, merchant-enabled artwork-later and production-option values. | Existing draft schema and save operation. Distinguish decoration size from garment size. Artwork-later means the merchant supplies production artwork after purchase. |
| Define a visual print specification | Product views and names; shared and variant-specific image selection; placement names, geometry and variant overrides; decoration-size names and bounds; an accessible way to adjust geometry alongside the canvas. | Existing normalized geometry and visualizer contracts. Geometry is image-relative. Do not imply a measured physical print dimension unless the selected data supports it. |
| Set exact prices | Final per-garment method × placement × decoration-size prices, explicit zero, unavailable/missing combinations and current shop-currency context. | Existing Lean pricing contract. Setup charges, tiers, FX and additive pricing layers are not new Lean authoring capabilities. Preserve exact amounts and explain currency changes rather than silently relabeling them. |
| Maintain a draft | Save, dirty indication, discard confirmation, field-level validation, stale-draft comparison/recovery and retention of local edits after a failure. | Existing CAS and idempotent command contracts. Controls must distinguish failed, rejected, conflicting and unknown outcomes. A raw JSON editor exists today; it is not a requirement for ordinary merchant use. |
| Reuse configuration | Choose a target product, explain independent copying and confirm the observed result before offering another copy. | Existing copy command. Copy does not create synchronized product configurations. |
| Publish safely | Review the intended saved version, state the effective published version, show eligibility blockers, request publication and observe/reconcile that exact request. | Existing publication state machine. Accepted/pending/active/conflict/operator-held/restoration states are different. Do not show success or offer another publish just because a command returned. |
| Triage orders | Locate a purchase, understand artwork readiness and retention, inspect real purchased variants/quantities and identify reconciliation exceptions. | Existing list/detail APIs. Artwork filtering currently covers only loaded orders. Global search/filter/sort would need API work; changing the visual control alone cannot make the result complete. |
| Obtain production files | Preview current artwork, obtain an original download, see its expiry, retry access and distinguish purchased original from later replacement. | Existing private scoped preview/download APIs. A preview is a raster derivative, not the production original. Expired links require fresh authorized access. |
| Supply missing or replacement artwork | Supported-file upload, processing/rejection state, retry an already-uploaded file, select the verified asset and explicitly attach/replace it for the intended placement. | Existing upload and purchase-attachment APIs. Upload completion alone does not attach artwork. Required purchase/design retention and lock rules apply. |
| Finalize artwork | Explain lock consequences, lock the exact current attachment version and preserve the locked state through refresh, conflicts and erasure. | Existing lock API, restricted to READY and eligible retained detail. No unlock endpoint was found. Confirmation before locking is a recommendation; reversal would require a product/backend decision. |
| Check Shopify order facts | Refresh the retained view and request independent order reconciliation, with a clear pending result. | Existing schedule-based reconcile API. It does not synchronously prove a changed payment state. Payment/refund/fulfillment mutations remain Shopify responsibilities. |
| Maintain reusable methods | Create, rename, remove and recover a conflict or uncertain write. Explain what is shared and what is copied into a product. | Existing template API with optimistic versions. Templates supply names; published product prices and geometry do not become linked to a mutable global template. |
| Set up the storefront | Link to the relevant theme-editor block/embed action and explain the merchant's save/test steps. | Existing App Bridge-context-dependent links. No installation verification/readback or automatic theme write is exposed by this page. Opening an editor is not completion. |
| Understand publication readiness | Explicit permission check/consent, current readiness details, a specific blocker and the next permitted action. | A readiness API exists. The generic readiness control currently discards the returned details and reports that a check completed. Use authorized result details in the redesign rather than implying a generic check grants eligibility. |
| Manage subscription | Actual current status and observed terms, trial/cycle end, pending changes/cancellation, effects on new actions and the supported Shopify management destination. | Existing read-only billing API plus external management URL. No app-local subscription mutation, usage dashboard or multi-plan selector. |
| Fulfill privacy obligations | Find requests and due dates, open the requested-order manifest, download retained records/designs/originals and handle unavailable data explicitly. | Four read-only privacy API patterns. No create-request, erase-now or mark-delivered/complete control is backed by these routes. Downloading is not proof of customer delivery. |

The product details and their source anchors are in the [product appendix](admin-product-controls-2026-10-20.md). Order controls and constraints are implemented in [list/filter](../../../apps/web/src/islands/PurchaseArtwork.tsx#L319), [placement access/attachment](../../../apps/web/src/islands/PurchaseArtwork.tsx#L165), [lock](../../../apps/web/src/islands/PurchaseArtwork.tsx#L605), [history/refunds](../../../apps/web/src/islands/PurchaseArtwork.tsx#L633), [historical preview](../../../apps/web/src/islands/PurchaseHistoricalPreview.tsx#L8) and [upload controls](../../../apps/web/src/islands/ArtworkUpload.tsx#L31). Settings/readiness behavior comes from [ReadinessPermissions](../../../apps/web/src/islands/ReadinessPermissions.tsx#L35), [StorefrontSetup](../../../apps/web/src/islands/StorefrontSetup.tsx#L8), [billing display](../../../apps/web/src/islands/MerchantBilling.tsx#L61) and [privacy exports](../../../apps/web/src/islands/MerchantPrivacy.tsx#L125).

## API exposure and permissions

The source exposes 28 merchant method/path combinations across three API families. The count includes a private development-owner signing operation, which is not an ordinary merchant control. It excludes buyer/guest APIs, webhook ingress, internal metrics and storage-provider URLs. The [API appendix](admin-api-inventory-2026-10-20.md) defines the count and lists every method/path pair.

| API family | Method/path combinations | Responsibilities |
| --- | --- | --- |
| `/api/admin/...` | 12 | Catalog and configuration commands, method library, billing, readiness and private signing allocation. |
| `/api/artwork/...` | 5 | Merchant upload admission, completion, status, safe preview and original download. |
| `/api/purchases/v1/...` | 11 | Purchases, purchase-bound artwork access/attachment/lock/reconcile and four privacy-export reads. |

Do not derive authority from what a page or button is visible. Authentication binds an App Bridge identity token to the online Shopify staff grant and current durable installation. Product reads require product-read access, and editing requires `write_products`, across app, user and installation grants. The current implementation further requires the verified account owner for private artwork; purchase/privacy access also requires `read_orders`. This currently limits delegation to non-owner production staff even if they have product permissions. Changing that is an authorization/product change, not a presentation fix. [Authenticator](../../../apps/web/src/server/admin/auth.ts#L149)

Browser requests use no-store, omitted credentials, bounded deadlines and one fresh-token retry on 401. Mutations additionally pass origin/body/schema checks. Some authenticated requests can initialize or refresh durable offline credentials, so GET does not imply that no internal authentication state is ever written. Preserve those distinctions when categorizing effects. [Browser request helper](../../../apps/web/src/shared/admin-request.ts#L48), [backend appendix](admin-api-inventory-2026-10-20.md)

## Gaps and decisions before implementation

- Provide ordinary structured editing for supported settings. Current raw JSON access should not compensate for missing merchant controls. Views, placements, sizes and individual option values lack ordinary removal controls; dependency-safe draft editing can use the existing full-draft save contract, but deletion behavior needs explicit validation/recovery. [Product appendix](admin-product-controls-2026-10-20.md)
- Add an exact selected-decoration surcharge review. The current product preview shows image/geometry/artwork, and its review section gives names/counts rather than the intended sum. Current price cells can support the decoration sum; a full contextual garment quote would need a qualified server read because the catalog DTO contains no prices. Product-preview sample artwork also uses the real private upload/inspection pipeline in normal operation, so it must not be presented as a purely local file operation. [Product appendix](admin-product-controls-2026-10-20.md)
- Decide how users should find the complete order set. The current client-side artwork filter is explicitly partial. Do not label it as a store-wide result. [Filter implementation](../../../apps/web/src/islands/PurchaseArtwork.tsx#L386)
- Present publication blockers and uncertain command recovery as merchant tasks. Infrastructure signing/release provisioning is not a default merchant settings form. There is no ordinary UI caller for the private signing endpoint. [API appendix](admin-api-inventory-2026-10-20.md)
- Treat no-op, failed, pending and unavailable results explicitly. Theme setup links do not confirm installation; subscription observations do not approve a change; reconciliation requests do not confirm fresh order facts; downloaded privacy records do not confirm fulfillment. [Setup](../../../apps/web/src/islands/StorefrontSetup.tsx#L57), [billing](../../../apps/web/src/islands/MerchantBilling.tsx#L94), [reconcile](../../../apps/web/src/islands/PurchaseArtwork.tsx#L351), [privacy](../../../apps/web/src/islands/MerchantPrivacy.tsx#L78)
- Account for denied access and real expiry throughout. Authorization loss clears private purchase/privacy data. A retained economic record does not guarantee retained production detail or artwork. Historical previews must use the purchased original rather than silently substitute replacement art. [Purchase denial](../../../apps/web/src/islands/PurchaseArtwork.tsx#L309), [privacy denial](../../../apps/web/src/islands/MerchantPrivacy.tsx#L34), [historical preview](../../../apps/web/src/islands/PurchaseHistoricalPreview.tsx#L8)
- Preserve an effective distinction between saving and publishing. App Bridge host Save Bar and the fallback both protect dirty state; discard/navigation cannot erase ownership of an unknown write. These are behavioral obligations, not a requirement to keep today's toolbar arrangement. [Save/navigation behavior](../../../apps/web/src/components/AdminSaveBar.tsx#L30)

No merchant endpoint was found for deleting an entire product configuration, unpublishing customization, unlocking production artwork, placing refunds, changing fulfillment/inventory, manually sending privacy completion, managing app users or editing a global platform account. Absence here describes the checked source. New controls for those actions need an explicit supported contract rather than a decorative button. [API appendix](admin-api-inventory-2026-10-20.md)

## Verification and limits

Completed on the pinned Node 24.21.0 and pnpm 12.6.0 setup:

- Installed the unchanged frozen workspace lockfile.
- Built the workspace successfully. Astro checked 105 files with zero errors, warnings or hints.
- Ran 36 focused existing tests across admin authentication/commands/methods/billing, merchant artwork, purchase requests and privacy requests. All passed, with no skips. These exercise local service doubles and real handler/auth logic, not Shopify's live account state.
- Cross-checked route files, shared controls, browser-safe views, concrete service handlers and relevant regression sources. The API and product-control investigations were independently delegated and reconciled into this report.
- Validated 246 local links and source anchors across the three notes, checked the 28 documented API pairs for uniqueness, and passed `check:source` with zero untyped or unchecked source files.

The standard credential-free `dev:admin` preview did not start in this local environment. The built server imports `parseCookie` and `stringifySetCookie` from `cookie`, but its resolver selects `/Users/pc/node_modules/cookie/index.js`, whose CommonJS exports do not provide `parseCookie`. The pinned Astro dependency is `cookie@2.0.1`; the ancestor resolution is a local startup problem. Build success is therefore not a successful preview or browser observation. No screenshot, visual acceptance or live merchant qualification is claimed, and this research did not alter application behavior to bypass the problem.

Reproduction commands were `corepack pnpm build`, `corepack pnpm dev:admin`, then the focused tests:

```sh
node --test apps/web/test/admin/auth.test.mts apps/web/test/admin/commands.test.mts apps/web/test/admin/methods-http.test.mts apps/web/test/admin/billing-http.test.mts apps/web/test/artwork/http.test.mts apps/web/test/purchase-request.test.mts apps/web/test/privacy-request.test.mts
```

All browser findings in the appendices are descriptions of source and existing regression cases unless explicitly marked as executed. No native Shopify/provider calls, app release, installation, store mutation or product redesign occurred in this investigation.
