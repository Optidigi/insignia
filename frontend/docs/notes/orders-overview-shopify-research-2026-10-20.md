# Orders overview Shopify research

20 October 2026. Research for the Orders collection page in Insignia's hosted Astro/Preact App Home. Shopify's official skill and versioned documentation search used `polaris-app-home` with `2.0-rc`. This note proposes implementation constraints. It does not record native observation or owner design acceptance.

## Pattern and runtime

Use the resource index pattern. It provides a collection table and links to resource details. Its create, import, export, search and bulk-action examples demonstrate capabilities an app may support; they do not require Insignia to invent those capabilities. The first-use empty state is separate from the populated table. [Resource index](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/resource-index)

Polaris 2.0 remains a release candidate. Its URL is `https://cdn.shopify.com/shopifycloud/polaris-2.0-rc.js`. Load App Bridge alongside it and match the type-package release to the runtime. Exact prerelease pinning avoids a later stable package moving beyond the RC runtime. The bundle follows the merchant's current admin appearance; a separate appearance flag or bundle is unnecessary. Shopify currently recommends the stable 1.x channel for production, so adopting 2.0 here follows the owner's explicit development target and is not production release approval. [Versioning](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/versioning)

## Component contracts

| Component | Verified contract and proposed use |
| --- | --- |
| `s-page` | `heading="Orders"`; `inlineSize` accepts `small`, `base`, `large`. Use `large` for the collection. Put a real page-wide Refresh button in `secondary-actions`. That slot accepts buttons or button groups using `secondary` or `auto`. A primary action is optional; its slot requires one primary button. |
| `s-section` | Wrap the collection with `padding="none"` and an accessibility label, as in the index template. |
| `s-table` | Boolean `paginate`, `hasNextPage`, `hasPreviousPage`, `loading`. `variant="auto"` switches between desktop table and narrow list. The `filters` slot accepts filter inputs. Events are `nextpage` and `previouspage`; JSX handlers are `onNextPage` and `onPreviousPage`. |
| Table structure | `s-table-header-row`, then `s-table-body` containing `s-table-row` / `s-table-cell`. Headers accept `format="base"`, `"numeric"`, `"currency"`. Mobile `listSlot` accepts `primary`, `secondary`, `kicker`, `inline`, `labeled`. |

Page facts come from [Page](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/layout-and-structure/page). Table facts come from [Table](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/layout-and-structure/table). The resource index example supplies the section composition. The official resource-index JSX example currently includes a validation exception for `s-empty-state`; that example is not permission to suppress type or catalog failures in Insignia. Validate the exact generated component markup against `2.0-rc`.

Proposed columns are Order, Date, Artwork status and Total. Give Order the primary mobile slot, artwork inline, Date secondary and Total labeled with currency formatting. These are Insignia choices using Shopify's mobile table contracts. Preserve exact minor-unit money formatting and a readable order-ID fallback when optional Shopify order names are unavailable. Do not claim a customer name, fulfillment state or store-wide count that the current DTO does not supply.

## Query and filter boundary

Shopify's migration guidance treats the controls, table, pagination and backend query as one feature. Keep restorable query values together, reset cursors when the query changes, prevent stale responses replacing newer results and retain the chosen controls with a retry path on failure. Omit saved views if the backend cannot persist them. [Index filters migration](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/index-filters)

Insignia currently accepts only `before` and `limit`, with HTTP limit 1–50 and default 20. The service fetches one extra record to derive `nextCursor`. The repository sorts by recorded purchase `created_at` and `purchase_id`, both descending. This is not a documented sort by the Shopify order's displayed date. Sources: [HTTP](../../../apps/web/src/server/purchase/http.ts), [service](../../../apps/web/src/server/purchase/service.ts), [repository](../../../packages/database/src/repositories/purchase.ts).

Recommendation for this first page: use native table pagination and omit global search/filter controls until the query supports them across the collection. If preserving the existing local artwork filter is necessary, label its page scope explicitly and retain next/previous navigation even for a page with no matches. A message that there are no matching orders anywhere would be false. Proper collection-wide artwork filtering would require a validated HTTP parameter, filtered repository query before the page limit, stable filtered cursor behavior and tests through that contract. This recommendation is an Insignia inference from the current backend and Shopify's query guidance.

## Copy and states

Shopify says to match its admin voice, avoid duplicated titles/navigation, use short plain sentences and keep one consistent term for each concept. That supports a single Orders title without a slogan or a second body heading that repeats it. [Content](https://shopify.dev/docs/apps/design/content)

Use sentence case for headings and actions, concise labels, and month names or three-letter abbreviations for dates. Preserve locale-aware formatting where the app has reliable context. [Grammar and mechanics](https://shopify.dev/docs/apps/design/content/grammar-and-mechanics)

Routine workflows should get merchants to their task without extra prose. Error copy should explain the problem and an available recovery, without raw HTTP codes, intimidating technical words or celebration. [Voice and tone](https://shopify.dev/docs/apps/design/content/voice-and-tone)

Suggested Insignia state copy, to check against actual behavior:

- First-use empty: `No customized orders yet`, with one short explanation that customized orders appear here after purchase.
- Read failure: `Orders couldn't be loaded` with `Try again`.
- Access failure: explain that Insignia must be reopened from Shopify; do not show stale order data.
- Page-local no results, if used: `No matching orders on this page`, with a way to clear the filter and pagination still available.

Keep first-use empty, no results, denied and failed reads separate. Initial skeletons must preserve the project's silent accessible loading requirement. During subsequent reads, `s-table loading` can retain table context while preventing conflicting interaction. Verify narrow layout, keyboard access, next/previous paging, request races, retry and exact money in the rendered app. Component validation alone cannot establish those behaviors.
