# Whole-admin integration audit

2026-11-08. Read-only review of the current `main897a44e4` checkout against the selected-admin ownership guide and implementation map. No app source files changed. The native observations below were supplied by the parent audit agent; I did not control the shared browser. The existing focused `merchant-home-source` test file passed (5/5); a separate pure helper probe reproduced the paginated published-product omission. No builds were run.

## Findings

### P2 — Three customer-wording sections have no category labels

The Translations overview's **Other text** area and the editor's Section dropdown each show three indistinguishable **Unavailable** entries. These are the live `host`, `language`, and `startup` customer-wording groups.

`customer-wording.ts` derives groups from each customer message's first key segment. `MerchantTranslations.tsx:73-74` uses that group ID as the section ID; `:172-173` includes each group and looks up `settings:translations.groups.<id>`. The component only removes four old host-harness entries at `:30-32`: the remaining host discard-confirmation entries stay in the manifest, as do all three language and all three startup entries (`customer-wording-labels.ts:6-16,26-28`). The sections not in the seven customizer groups are placed under Other text at `:319-321` and rendered in both locations at `:446-458` and `:557-560`.

The group labels are missing from all six supported Admin catalogs: English, Dutch, German, French, Spanish and Italian. The English catalog's group table lists existing groups at `frontend/localization/src/catalogs/en/settings.json:291-305`; generated `AdminMessageTable` likewise contains only the current set at `frontend/localization/src/generated/catalog-types.ts:2527-2540`. `host`, `language`, and `startup` are absent in the other five catalog group tables too. The dynamic key is hidden from type checking by a cast at `MerchantTranslations.tsx:173`; missing keys reach the translator's generic `Unavailable` fallback (`frontend/localization/src/internal/fixed-translator.ts:109-117`). This accounts for the exact three duplicate labels seen natively. Field labels for those messages are present; the defect is the section names, not missing customer copy.

**Impact:** merchants can still open the sections, but cannot distinguish them by name, so locating startup recovery, language-picker, or design-switch wording is unreliable. Source tracing establishes the cause; native screenshot evidence was observed by the parent audit agent.

### P1 — Native Methods and product editor loads fail at their shared method-catalog dependency

The parent audit agent observed fresh native loads for `/admin/methods` and two product config pages fail with “could not be loaded”; retry did not recover. `/admin/products` loaded. This is a shared primary-workflow availability failure, though the root cause is not proven.

In current source, `MethodsContainer.load()` starts with `GET /api/admin/methods?view=catalog` and treats any exception as a page-level load failure (`frontend/admin/src/islands/MethodsContainer.tsx:44-61`). The product editor first loads product/preferences, then also requires that catalog before it hydrates the editor (`frontend/admin/src/islands/SelectedProductContainer.tsx:193-228`); its catch collapses any error to the failed screen (`:253-263`). The product list uses a separate `/api/admin/products` request (`frontend/admin/src/islands/ProductsOverview.tsx:137-143`), consistent with that route loading independently. The shared catalog handler reads Shopify shop currency before returning the catalog (`apps/web/src/server/admin/methods.ts:131-143`, `apps/web/src/server/admin/production.ts:934-944`), making this a common dependency to investigate. Available evidence does not identify whether the failure is auth, provider response, network, or data-specific; do not treat the currency call as confirmed cause.

**Evidence:** parent-observed native failure plus source trace. Repeatability was observed for two product IDs and the Methods page; no native network response or server log was available to this audit, so the root-cause attribution remains unverified.

## Reviewed but not reported

- Settings Privacy is present, but current `docs/architecture/implementation-plan.md:418-419,760` explicitly maps `/admin/settings/privacy` to the retained privacy capability. I did not classify the route as an accidental demo/backend leak from current-head source alone.
- Billing's zero-dollar `Development test terms` is derived from a provider-recognized development subscription (`apps/web/src/server/admin/billing.ts:37-64`) and is called out in current delivery state. `billingMoney()` preserves the exact decimal precision returned by the provider (`frontend/admin/src/shared/billing-display.ts:1-27`). The observed `USD 0.0` does not establish a plan/data mismatch; no billing display issue is reported here.

## Orders, Home, and Methods follow-up

### P2 — Home omits the test invitation when the published product is beyond the first catalog page

The production `/admin/home` route mounts `MerchantHomeContainer` (`apps/web/src/pages/admin/home.astro:1-15`). The container requests only `/api/admin/products` (`frontend/admin/src/islands/MerchantHomeContainer.tsx:53-61`); that endpoint defaults to 20 products and caps requests at 20 (`apps/web/src/server/admin/http.ts:238-250`). Shopify returns that list title-sorted (`packages/shopify/src/catalog.ts:60-64`).

The product-panel adapter correctly marks a page with `nextCursor` as globally `unknown` and omits `hasPublishedProduct` if no published product appears on that page (`frontend/admin/src/shared/merchant-home-source.ts:21-47`). However, the separate `homeHasPublishedProduct()` helper ignores `nextCursor` and checks only the current page (`:154-156`); the container stores that page-only boolean as the store-wide published fact (`MerchantHomeContainer.tsx:58-61`). If both storefront extensions are active, `homeSetupFromTheme()` returns no setup guidance when that boolean is false (`merchant-home-source.ts:111-129`). Thus a store with more than 20 products and a published configured product after the first title-sorted page gets no Home test invitation, despite having a qualifying product.

**Evidence:** reproduced with a pure helper probe using a synthetic 20-item page, a non-null cursor, and a known published product on the next page: the panel correctly reported `catalog: 'unknown'`, but the page-only published check returned `false` and active-theme setup returned no task. Controls behaved as expected: a complete empty catalog produced no invitation, while a complete page containing a published product produced the pending test invitation. This is a source/helper reproduction, not a native reproduction against a shop with more than 20 products.

The existing test checks that the product panel reports `unknown` when a cursor exists (`frontend/admin/test/admin/merchant-home-source.test.mts:11-20`), but does not exercise the separate published-product fact or its composition with active theme status. This also misses the limitation recorded in the Home design note: publication absence cannot be established from one title-sorted page (`frontend/docs/notes/home-v1-design-2026-10-26.md:47-49`).

### No additional Orders or global Methods assignment mismatch found in source review

The production Orders routes mount `OrdersOverview` and `PurchaseArtwork` (`apps/web/src/pages/admin/orders/index.astro:1-28`, `[purchaseId].astro:1-30`). The list uses authenticated paginated server queries for search, artwork status, sorting, and date filters (`frontend/admin/src/islands/OrdersOverview.tsx:180-220,245-269`). Detail attachment/replacement is guarded by upload permission, available order lines, unlocked state, and unexpired payload, and uses an expected artwork version (`frontend/admin/src/islands/PurchaseArtwork.tsx:184-231`). ZIP/PDF preparation and download paths re-read/validate order data and surface bounded/export errors (`frontend/admin/src/components/ArtworkArchiveDownload.tsx:81-170`; `frontend/admin/src/components/BatchProductionSheets.tsx:73-165`; `frontend/admin/src/shared/artwork-archive.ts`; `frontend/admin/src/shared/production-sheet-batch.ts`). No local demo transport or source-level loss of the selected interactions was found in these flows. The parent audit agent observed the live Orders list recover on Retry with the newest order first; detail and exports were not exercised natively here.

The production Methods route uses `MethodsContainer` to load the authenticated method catalog and the complete product set before rendering selected assignment UI (`frontend/admin/src/islands/MethodsContainer.tsx:44-102`). The selected UI supports manual product/collection selection and tag any/all assignment (`frontend/admin/src/islands/SelectedMethods.tsx:743-874`); its tag matching rule is consistent with the production contract (`frontend/admin/examples/admin/support/method-configuration.mts:66-77`, `packages/contracts/src/v1/method-catalog.ts:114-126`). I found no separate global-assignment parity or data-mapping defect. This does not change the earlier native Methods load failure finding, which remains un-attributed to a root cause.

## Limits

The parent audit agent supplied native observations for Home, the Orders list, and Methods; this follow-up used source review and a pure helper probe for the Home pagination defect. Order detail, ZIP/PDF downloads, and global Methods assignment were not exercised natively. The Methods/product load failures were not reproduced locally and no network/server traces were available. No data was edited and no production or external mutations were attempted.
