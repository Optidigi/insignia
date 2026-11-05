# Buyer state completeness audit

28 October 2026. Independent audit of the production Preact buyer and the sibling Preact designer prototype after the reducer migration. The production buyer issues whole-quote v2 authorization and applies real Shopify cart lines. The sibling keeps a local simulated cart and does not call Shopify (`../../../../designer-prototype/src/designer.tsx:18-20`). Findings below do not combine those contracts.

## Confirmed finding

### [P2, confirmed] A decoded artwork upload stays in the loading state in the designer prototype

`Designer.upload()` dispatches `upload-started` with a new token. The reducer records that token in `uploadVersion` (`../../../../designer-prototype/src/designer.tsx:563-576`; `../../../../designer-prototype/src/designer-state.ts:253-260`). After FileReader and image decode succeed, the caller dispatches `upload-succeeded` with the same token. The reducer accepts success and failure only when `isCurrentUploadTarget` returns true (`../../../../designer-prototype/src/designer.tsx:578-610`; `../../../../designer-prototype/src/designer-state.ts:261-285`). That helper requires `token > state.uploadVersion` (`../../../../designer-prototype/src/designer-state.ts:563-574`). For an active upload the values are equal, so the reducer discards both completion events. The upload dialog remains on “Opening file…”, disables Browse, shows no error and never adds the file to the library.

I reproduced the issue through the browser using a valid 32×32 SVG. From `insignia/apps/storefront`, run:

```sh
PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH node /tmp/insignia-buyer-upload-repro.mjs
```

Output:

```json
{"uploadStatus":"Opening file…","probePresentInLibrary":false,"error":0}
```

The scratch browser uses a temporary loopback Vite server and a synthetic local file. Capture: `/tmp/insignia-buyer-upload-repro.png`. The prototype source digest during the probe was `44bb6903964d20101821654e50c76b66a4f27cb95f920f227da7a2f5d326b2ff`.

**Buyer consequence:** people testing the prototype cannot add their own artwork. They can still close the picker and choose a sample, or use the permitted “Artwork to follow” option. This is a broken inline transition, not a missing page. No new UI is needed.

**Minimal correction:** distinguish a new token from the current in-flight upload. Keep the `token > uploadVersion` check for starting an upload; accept success/failure only for the active reading token and target. Add successful-decode and decode-failure browser coverage, while retaining the cancellation/stale-result case.

**Evidence gap:** the existing browser suite covers cancellation while FileReader is pending (`apps/web/test/admin/designer-state-browser.test.mts:417-466`) and stale/canceled reducer results (`:468-757`), but has no successful upload assertion. The rest of that suite passed, including all 13 scenario fixtures, desktop/390/320, dark and long-content captures, remove/undo, edit/replace/resume, product return, browser history and quantity/cart checks.

## Production buyer review

The production buyer has inline states and recovery for the main purchase journey. I found no second confirmed dead end and no missing page requirement within the requested source and browser scope.

The source distinguishes closed/bootstrap, load denied/failed, editing, price review, acceptance, cart application/removal, completion and recovery (`apps/storefront/src/buyer-state.ts:27-80,206-415`). Bootstrap results require the current request and product; failed loads can be retried by closing and reopening the customizer. Expired proposals lose their Add to Cart action while preserving selections for a fresh review (`buyer-state.ts:282-300`; `apps/storefront/test/buyer-state.test.mts:178-194`). Review, acceptance, removal and renewal have synchronous ownership, stale-result checks and explicit completion (`buyer-state.ts:422-559`).

The public browser journeys exercise retained designs, full-cart price review, ordinary-line preservation, external cart changes, remove, renewal key replay, configuration republish, missing preview geometry, no-preview review, mobile navigation and close confirmation (`apps/storefront/test/buyer-browser.test.mts:41-252,372-433,701-869`). There is no customer-side undo/history for production buyer drafts; restored designs come from observed cart state, and cart mutation recovery stays in the separate adapter, consistent with the production buyer inventory (`docs/delivery/notes/frontend-state-buyer-inventory-2026-10-27.md:28,43-70`). Shopify owns order returns, refunds and cancellations (`docs/architecture/implementation-plan.md:15`), so I did not count those as missing customizer pages.

### Known cart-status limitation, not counted as a new dead end

The server can return `repairRequired` from cart-state (`apps/web/src/server/buyer/service.ts:364-455`), and bootstrap types that field but does not read or preserve it (`apps/storefront/src/customizer.tsx:149-171`). The existing 26 October audit already records this omission and says the buyer does not promise to repair every incompatible or unrestorable cart (`docs/delivery/notes/storefront-setup-failure-audit-2026-10-26.md:46-52`). The cart embed opens the customizer for any marked line, while the customizer offers full review/renewal when it can restore designs and “Remove all customized items from cart” in recovery (`apps/storefront/src/element.tsx:85-125`; `customizer.tsx:1401-1409`). I did not observe a dead end in the scoped public paths, so I am not raising this as a new blocker. If product owners want a distinct expired/incomplete-set warning, that is a small status presentation decision, not a new page.

## Verification

All commands used Node 24.21.0. They ran isolated browser origins and synthetic fixtures; I did not build, reset, checkout, or write to Shopify.

| Scope | Command | Result |
|---|---|---|
| Production buyer reducer/controller | `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH corepack pnpm exec node --test apps/storefront/test/buyer-state.test.mts` from `insignia` | 11 passed, 0 failed |
| Production buyer browser | `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH node --test test/buyer-browser.test.mts` from `insignia/apps/storefront` | 11 passed, 0 failed |
| Sibling buyer browser/model journeys | `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH INSIGNIA_DESIGNER_PROTOTYPE_ROOT=/Users/pc/Development/Insignia/designer-prototype corepack pnpm exec node --test apps/web/test/admin/designer-state-browser.test.mts` from `insignia` | 8 passed, 0 failed |
| Prototype valid-file repro | `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH node /tmp/insignia-buyer-upload-repro.mjs` from `insignia/apps/storefront` | Exits 0 and records the stuck-loading output above |

The failed upload repro is the only confirmed finding from this audit. The recommendation is a reducer transition correction plus two focused browser assertions; it does not require a new page, a backend change, or production Shopify qualification.

## Correction follow-up

Root corrected the upload transition guard and recorded a failing-then-passing actual phone browser regression for success, decode failure and retry. Independent Sol verification passes nine buyer checks across all 13 scenarios, with a separate desktop/320px invalid-file-to-valid-PNG probe. This audit preserves the original finding; the [consolidated correction and integrated verification record](state-completeness-audit-2026-10-28.md) owns the final result.
