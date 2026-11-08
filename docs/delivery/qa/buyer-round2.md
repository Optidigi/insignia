# Buyer/native storefront QA — round two

**Date:** 2026-11-08
**Store:** insignia-rewrite-dev.myshopify.com
**Route:** native Shopify product → selected Insignia Designer modal → native Shopify cart
**Product:** Insignia Superfunny T-shirt demo, product 10588458647835; protected rich fixture with 6 colors, 64 actual variants, 4 views, 6 placements and 24 photo references
**Browser/content viewport:** Chrome CUA, 2560 × 1323 screenshot viewport
**Customer UI locale/currency:** German labels, USD cart
**Source/runtime:** workspace HEAD d750e5ceb38d403768ebea10f57ea6d8066d9f27. The Shopify web image changed during this run from sha256:76d5d0f90df31f9643f590476f49cd4e12bb7485bc1240ebb3dd5b568ec49e77 (started 20:24:30Z) to sha256:001ffe0481d65cc6e630d8fe92e7191f4af84b9cd6a318abc6c324df1f2d21c7 (started 22:05:03Z). The already-open Designer frame was not reloaded as part of this run; the later reload refreshed Shopify /cart, not a new Designer entry. Treat cart findings as the observed old-frame/current-backend interaction, not as complete qualification of the newly started web image.
**Native timing:** cart quantity-2 readback screenshot 22:17:40Z; restored quantity-1 screenshot 22:19:13Z; empty-cart readback screenshot 22:19:36Z. All three were after the 22:05:03Z runtime start.

## Result

Nine buyer case groups were sampled. Open/close, position selection, variant availability, defer-artwork progression, review, direct draft resume and cart-design reopen worked in the observed states. Narrow viewport and artwork upload/movement were not exercised.

A native cart quantity edit exposed a customer-visible price and review regression. The review quote for one Zwart / XS shirt was $17.45 per item, shown as $9.95 base plus $7.50 Linkerborst standard decoration. Adding one item produced a single $17.45 cart line. Increasing that same line to quantity 2 changed the line price to $9.95 each and the cart total to $19.90. A fresh /cart reload preserved that price and quantity. The cart showed no review-required/repair warning, no “Review customized cart” control, and an enabled Checkout button. Checkout was not clicked.

Reducing the same line to quantity 1 restored the $17.45 amount and the “Review customized cart” control. Reopening that control restored the exact saved product, Linkerborst placement, standard size, deferred-artwork choice and quantity 1. The own line was then removed; a fresh /cart reload confirmed the cart empty. No other line was present or touched. No checkout, order, email or file upload was attempted.

The exact service-side cause is unproven. No claim is made that cart metadata/carrier properties were removed. A cart read through Shopify’s rendered JSON route was blocked by the browser, so verification is limited to the native cart UI and fresh page reload.

## Case coverage

| Case | Result | Evidence and limits |
| --- | --- | --- |
| CUS-01 — open/startup/frame reuse | Partial pass | Opened from the native product page. Escape closed the modal and restored focus to the Shopify customize trigger. Direct canonical-link startup and frame reuse were not exercised. |
| CUS-04 — artwork/position dialogs and focus | Partial pass | Position selection opened the position chooser; Escape returned focus to the artwork control. “Motiv später nachreichen” enabled progression without opening the OS file picker. No artwork was uploaded. |
| CUS-07 — views, placements and artwork size | Partial pass | Confirmed available front/chest, front/belly, back, left shoulder and right shoulder placements across the four views. Standard and large size options displayed +$7.50 and +$10.00. Artwork movement could not be checked without artwork. |
| CUS-08 — sparse quantity matrix | Partial pass | The matrix showed 66 color/size cells across six colors and XS–7XL. White 6XL and 7XL were explicitly unavailable; the remaining 64 combinations were represented as selectable quantity cells. Narrow/adaptive layout was not exercised. |
| CUS-10 — progression, validation and back navigation | Partial pass | Quantities were blocked until artwork was chosen or deferred. Deferring artwork proceeded to quantities and review with the placeholder retained. The full validation matrix was not run. |
| CUS-11 — quote preparation and review | Partial pass | Review showed $17.45 per item with a $9.95 item + $7.50 Linkerborst breakdown and one selected unit. Cancellation, failure and retry states were not tested; server quote provenance was not independently inspected. |
| CUS-13 — cart add/update/receipt/removal | Fail for quantity update | One Add succeeded and navigated to /cart. Updating the owned line to quantity 2 and reloading lost the decoration amount ($17.45 → $9.95 per item). Checkout remained enabled and no repair/review warning appeared. Restoring quantity 1 restored $17.45. Removing the line and freshly reloading yielded an empty cart. |
| CUS-14 — close/reopen and saved design | Partial pass | Closing and reopening on the same product route resumed the exact draft. “Review customized cart” reopened the owned line’s saved design. Returning to the product through a recommendation after leaving the route opened a blank design identity; treated as a new identity, not a resume failure. Dirty design switching was not tested. |
| CUS-17 — language/theme/narrow viewport | Partial pass | German labels and light/dark modes were observed on desktop. No concrete matched-state presentation regression was found. Narrow viewport was not testable through the available CUA viewport controls. |

The color/view preview test showed Zwart/front, Zwart/back, Grijs/front and Grijs/left images. Grijs/back and Zwart/left showed the localized preview-load message. Destination image assignment and URL freshness were not freshly verified, so this remains a data/media observation rather than a UI finding.

## Evidence

Screenshots are captured directly from the Chrome CUA viewport and stored in the canonical evidence directory. The unique proof set and state manifest are in buyer-round2proofs/manifest.json.

- ../evidence/frontend-qa-2026-11-08/buyer-round2-cart-qty1-restored.jpg — owned cart line at quantity 1 and $17.45 after restoring quantity.
- ../evidence/frontend-qa-2026-11-08/buyer-round2-cart-qty2-after-reload.jpg — same line at quantity 2, $9.95 per item / $19.90 total, after a fresh /cart reload.
- ../evidence/frontend-qa-2026-11-08/buyer-round2-cart-empty-after-removal.jpg — empty-cart readback after removing the owned line and reloading.

The quantity 1 and quantity 2 images show the same native cart line at the two tested states. The accepted demo has no equivalent Shopify cart, so this integration-only state is evidenced by the native before/after pair rather than a demo/cart screenshot pair. The accepted demo remained the primary oracle for shared Designer interactions; its scenario data differed from this native product, so data/price differences were not treated as UI defects.

No changes were made to issues.json, state-cases.json, product configuration or app source by this QA pass.
