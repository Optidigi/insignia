# QA-002 Methods and editor loading diagnosis

**Source inspected:** `f2a405f3` (after PR252 merge).
**Evidence level:** source trace plus bounded facts supplied by the parent agent. No browser, Shopify, database, or deployment requests were made in this diagnosis.

## Current finding

The current native Methods failure is still unattributed. Native authentication stages succeeded during the observed failure, the development database has no Method catalog rows, and all four currently stored configuration drafts passed `MerchantDraftSchema` validation against clean `4a9cb951`. The last two facts rule out an invalid one of those four drafts and missing currency on a fixed Method as causes of this failure. They do not establish that the native Methods catalog/product HTTP responses succeeded or passed client validation.

The newly added inactive native-performance app version does not enter either startup path. Methods startup calls the authenticated Method catalog and product-list services. Product-editor startup reads the product/configuration, preferences and Method catalog. The closed release verifier is reached from publication preparation/advancement (`apps/web/src/server/admin/production.ts:177–235, 442–474, 548–564`), not these initial reads. An app-version inventory mismatch may affect publication verification, but it does not explain the initial Methods/editor load by this source path.

No native response ledger is available: the existing captures contain the final generic error only. The desktop browser surface available for this audit had no authenticated Shopify session, and no token extraction or auth bypass was used.

## Read path and failure boundaries

### Methods

`MethodsContainer.load()` (`frontend/admin/src/islands/MethodsContainer.tsx:46–150`) performs these reads in order:

1. `GET /api/admin/methods?view=catalog`; parse `MethodCatalogViewSchema`; require `shop`, `authority`, `currency`, and `canEdit` even though the contract marks them optional.
2. If editable, call `transport.resume()` against session storage. With a pending journal, this can replay a prior write. Invalid or expired journal data throws before the next HTTP read.
3. Fetch the same Method catalog endpoint a second time, parse it again, and check that any fixed-price Method has a currency. This second request is unconditional for editable users, even when `resume()` found no journal.
4. Fetch every page of `GET /api/admin/products`, parse a page-specific Zod schema, reject duplicate product IDs, and assemble the complete product list before mounting the selected Methods UI.

The production Method catalog endpoint calls `shopCurrency()` through Shopify GraphQL before querying the durable Method catalog (`apps/web/src/server/admin/production.ts:934–944`; `apps/web/src/server/admin/methods.ts:130–143`). With zero Method rows, the fixed-Method currency guard cannot explain the failure. A transient failure in either of the two catalog reads remains distinguishable only by the response ledger.

The production product-list reader obtains Shopify products, then attaches configuration summaries (`apps/web/src/server/admin/production.ts:274–298`). It queries `tags` and `collections(first: 20)` (`packages/shopify/src/catalog.ts:60–67`); collection truncation is carried through the API. Methods then rejects the whole list if any product has truncated collections (`MethodsContainer.tsx:96–115`). It also rejects products whose response omits `tags`, `collections`, `collectionsTruncated`, or `configurationSummary`, and rejects a configured product with no `methodSetup` (`:11–21, 96–115`). One such product prevents the entire Methods screen from mounting.

There is a real source-level contract edge for unavailable stored configurations: `productSummary()` returns the unannotated product when a stored draft fails validation (`apps/web/src/server/admin/product-summary.ts:13–14`), while the shared product DTO permits `configurationSummary` and `methodSetup` to be absent (`packages/contracts/src/v1/admin-view.ts:45–55`). The general product catalog explicitly maps a missing summary to `unavailable` (`apps/web/src/server/admin/catalog-query.ts:19`). Methods requires a summary and rejects the page. This path is **not the current native trigger for the four stored drafts**, which the parent checked successfully against the clean schema.

### Product editor

`SelectedProductContainer.load()` first loads the selected product/config and preferences, then reads `GET /api/admin/methods?view=catalog`, checks matching shop/authority/currency, and hydrates media (`frontend/admin/src/islands/SelectedProductContainer.tsx:193–267`). Its catch also discards the original error and shows the generic failed state. Parsing a saved draft or selected product can fail during `selectedProductFromConfig()` (`frontend/admin/src/islands/selected-product-view.ts:14–27`).

One related server read is intentionally non-fatal: `createMerchantConfigService.read()` catches shop-currency, draft-validation, and entitlement exceptions while computing publication eligibility and returns an unavailable eligibility reason (`apps/web/src/server/merchant-config.ts:432–455`). That caught eligibility error alone does not reject the config response. The separate Method-catalog read in the browser remains required.

## Error visibility

`authenticatedJson()` preserves an HTTP error's status and server message on the thrown `Error` (`frontend/admin/src/shared/admin-request.ts:54–77`). Methods and editor load catches immediately reduce that information to `{ kind: 'failed' }` (`MethodsContainer.tsx:148–150`; `SelectedProductContainer.tsx:253–263`). Zod issues and local guards such as “complete collections unavailable” are also hidden.

At the server boundary, expected catalog-query and authorization errors receive selected status codes, while unclassified errors—including underlying Shopify catalog transport/GraphQL errors—become `{ error: 'Admin service unavailable' }` with HTTP 503 (`apps/web/src/server/admin/http.ts:379–388`). The catalog transport itself has more specific internal error labels, but those do not reach the browser (`packages/shopify/src/catalog.ts:345–382`). Authentication emits stage observations with a correlation ID (`apps/web/src/server/admin/production.ts:649–652`); `adminJson()` does not return a request/correlation ID, and the route handler does not attach its later failure to the authentication observation. Thus “auth succeeded” narrows the failure after the authentication boundary but does not establish that the provider read, database read, HTTP response, or client parse succeeded.

## Existing fixture coverage

The selected Methods browser fixture returns one synthetic product with empty tags/collections, `collectionsTruncated: false`, `methodSetup`, and a configuration summary (`apps/web/test/admin/support/selected-browser.mts:146–166`; `apps/web/test/admin/support/selected-methods-browser.mts:27–41`). It does not exercise the complete native product catalog, unavailable summary, truncated collections, or pagination. The Method transport tests cover persisted write replay and currency adoption, but not `MethodsContainer` startup parsing (`frontend/admin/test/admin/method-catalog-transport.test.mts:30–79, 104–126`). These fixtures establish normal selected presentation behavior; they do not localize QA-002.

## Narrow next ledger

For one reproducible native Methods failure, capture the authenticated request sequence as a read-only ledger. Do not retain bearer/session tokens, raw opaque cursors, product/configuration bodies, or customer data.

| Entry | Bounded facts needed |
| --- | --- |
| Each `GET /api/admin/methods?view=catalog` | order, status, duration, whether the response is JSON, `methods` count, currency, and whether required identity/edit fields are present |
| Each `GET /api/admin/products` page | page ordinal, status, duration, product count, whether a next cursor exists, and counts of missing required fields, truncated collections, and repeated product IDs |
| Browser-side completion | whether the selected Methods workflow mounted; if all reads were HTTP 200, a sanitized local failure label or Zod issue path (no value contents) is required to distinguish response parsing from `resume()` or a local guard |

The first HTTP failure separates a server/provider failure from later reads. If every response is 200, inspect the bounded shape/check counts and the local failure stage. This ledger is the next actionable evidence; current source and the four valid stored drafts do not support a stronger attribution.
