# M5-001 synthetic Admin browser captures

`editor-initial.png` and `editor-edited.png` were captured by the committed
`apps/web/test/admin/editor-browser.test.mjs` Playwright test on 30 September
2026 with `M5_CAPTURE_BROWSER=1`. The test serves the built Astro Admin page,
uses the pinned local Polaris 1.1 fixture (SHA-256
`912455ad068713e7595f5a506fb7433a078554c327cf0fd30ce86ccb214818fe`),
hydrates Preact, and renders with direct Konva. The edited capture follows
variant/view/step changes, a canvas drag, and typed tier and presentment edits.

The shirt is a synthetic product with a one-pixel placeholder image. The gray
rectangle is the intentional `logo-later` preview. These local captures prove
UI interaction and canvas state, not live Shopify embedded authentication,
merchant artwork, product image parity, or publication activation. No owner
store, customer, staff, or credential data appears in them.
