# Superfunny LPO product visibility change

## Authorization and exact target

The owner explicitly authorized a one-product status change: set the Superfunny `Live Product Options Interactive T-Shirt` product to **Draft** through Shopify Admin, then verify its public URL is unavailable. This is the only source-store write in this task. No other Superfunny product, inventory, price, channel, theme, app or configuration was to be changed; the product was not deleted.

- Store/Admin host: `admin.shopify.com/store/superfunny-kleding` (Shopify header shows store **Superfunny**).
- Public product URL: `https://superfunny.nl/products/live-product-options-interactive-t-shirt`.
- Product ID: `15458471575936`.
- Product title read in Admin: `Live Product Options Interactive T-Shirt`.
- Handle read from the Admin search-engine listing URL: `live-product-options-interactive-t-shirt`.
- Creation/publication date from the public Shopify product JSON: 2025-11-28. The product predates this review.
- Admin locale: English; store price display: EUR.

## Before change

Admin page identity was verified at `/store/superfunny-kleding/products/15458471575936`: title and store matched the requested target; status showed `Active`. This single product was active at the time of read. Other product fields, variants, media, prices, inventory and channels were not changed.

**Status-save outcome:** In the verified product's Admin page, opened the `Status` control and selected `Draft` (`Not visible on selected sales channels or markets`), then clicked the page's `Save` button. The page briefly showed `Loading`, then showed a Draft badge but still displayed `Unsaved changes`; no second Save was attempted before reconciling.

**Fresh Admin reload:** at 2026-11-08 20:50:26 UTC, reloaded the exact product URL through the browser and read the full page again. It retained the same store, title and handle, and Shopify Admin showed status `Draft`. The status is now confirmed from a fresh readback. The product still has the existing EUR 10.00 price, no inventory tracking, and no other fields were intentionally changed.

**Public URL check:** After the fresh Admin readback, opened a new Chrome tab to the exact public URL, with no query string. At approximately 2026-11-08 20:51 UTC, the ordinary product route rendered the storefront's `404 niet gevonden` page (`Oeps! Pagina niet gevonden!`). The Shopify Preview Bar for the browser's existing theme preview session was visible at the bottom, so this was a plain product URL opened in a preview-enabled browser profile, not a clean-profile observation. No purchase/cart actions were made.

## Evidence

Persisted CUA screenshots:

- Fresh Admin Draft readback: [lpo-admin-draft.png](../evidence/frontend-qa-2026-11-08/lpo-admin-draft.png)
- Public product URL 404: [lpo-public-404.png](../evidence/frontend-qa-2026-11-08/lpo-public-404.png)

Both files contain PNG screenshots from the CUA tab. No authentication URLs or token-bearing query strings belong in this file.
