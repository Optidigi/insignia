# Polaris browser test asset

`polaris-2.0.snapshot` is an unmodified public copy of `https://cdn.shopify.com/shopifycloud/polaris-2.0.js` (Polaris web components 2.0.0 stable, the frozen 2.0 release), fetched on 2026-11-25. SHA-256: `af6e068300a7ec498092ecd2c4feb90bd93c43a2d8f75d27f65f86ae1f93d9f2` (919,721 bytes). The extension keeps the minified third-party library outside source linting.

The browser test verifies this digest and serves these bytes at the page's pinned CDN URL. The fixture is only for deterministic localhost testing; the page retains its public URL.

Shopify describes the versioned `polaris-N.M.js` files as frozen, immutable except for critical security fixes, and serves them with `cache-control: max-age=60`. Production can therefore drift slightly from this snapshot if Shopify ships such a fix. When it does, refresh the snapshot and digest. Revisit the moving `polaris-2.js` channel after Shopify app approval.
