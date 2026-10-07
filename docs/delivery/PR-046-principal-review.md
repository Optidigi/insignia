# PR #46 — external principal review

**APPROVED for normal merge as truthful STOPPED M5-015R evidence.**

Exact refs:
- base/effective merge base `6a186bea8e5d1c01a66f7ab683c06393fe81e991`
- head `38bac0cfabf96632e533e11df2ccfda9c513dea3`
- tree `b54b0f83beee01a06a5218af0a18f604f6e3482b`
- final-head CI 10/10 success, attempt 1
- native reviews none

M5-015R remains CLOSED / STOPPED `provider_shape`.

Exact fixture `gid://shopify/Product/10495813091611` is last verified ACTIVE/unarchived. All 10 outbound requests match durable accounting; create/setup are acknowledged, pending=0, unknown mutations=0. Acquire/resume/observe/restore/archive are NOT_RUN.

The ACTIVE product reported effective Publication `gid://shopify/Publication/339456917787`, while the complete unfiltered `publications` connection omitted it. The production v2 subset guard therefore correctly rejected the snapshot; do not weaken that guard.

The material issue is the assumption that unfiltered `publications` enumeration is complete configured-intent discovery. Current Shopify docs say it should be a flat list of all shop publications and also offer CatalogType filtering plus catalog discovery. Historical project evidence shows the omitted Publication is directly queryable and its `includedProducts` can expose the product.

PR #46 may merge. M5-015R must never be reopened.
