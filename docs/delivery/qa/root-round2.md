# Native qualification, round two

The accepted demo at PR223 `d490e4d0` is the behavioral and presentation reference. Native data, App Bridge chrome, currency and permission differences are compared separately. Checklist guidance applies only to states without a demo equivalent. This round changes QA catalog state and test records, not app code or runtime deployment.

## Catalog preparation

All six allowlisted QA copies are Active with Online Store publication timestamps. The imported catalog still has 261 actual tuples and 29 source gallery photos. The unisex shirt keeps the white XS–5XL exception. Existing unrelated products, USD/US and source Superfunny are unchanged. See `catalog-publication-round2.json`. This is Shopify catalog publication, not Insignia configuration publication.

## Root's hoodie authoring sequence

1. Opened product10590396317979 editor in native Shopify. It showed the selected zero-view initial state.
2. Add views showed37entries for3actual catalog photos. It repeated the featured photo, per-variant photo references and gallery. Selecting the black front photo changed13entries to Inuse, confirming repeated resource identity. Source `apps/web/src/server/admin/production.ts` concatenates those records without deduplication. Cap agent independently saw11for5photos. RecordedQA-011.
3. Selected firstphoto and added a view; renamed it Front. Added a placement, named it QA chest. Chose methods, correctly saw the empty-library guidance, added product-only Bedrukken, and supplied explicit7.50USD Standard price. Enabled orders without artwork for the owned smoke fixture. These UI transitions worked. This is a partial smoke setup, not an exact source geometry/calibration import.
4. After shared dialogs closed, four native host scrims remained. The top58.5px scrim intercepted the center of Save draft, confirmed by DOM hit-testing. Native Save/Save draft did not settle the unsaved state. A fresh editor tab failed startup and Retry; a dev-only READ ONLY query returned0configrows for the hoodie. No successful persistence or publication claimed. This is the existingQA-001 blocker plusQA-002 startup failure, not a new save defect.
5. Demo Addviews X closed normally. Both versions reuse the same picker hierarchy; real gallery data differ. Saved two pairs: gallery open and after dismissal. The latter pair compares host cleanup, not equal configuration content.

## Evidence and limits

Native web image was freshly inspected as `sha256:76d5d0f90df31f9643f590476f49cd4e12bb7485bc1240ebb3dd5b568ec49e77`, started20:24:30.41330255Z. PR253/254 are merged and CI-qualified but this campaign has not deployed them. The demo server at62171 uses the isolated clean worktree, with the reviewed modal fix; it is not evidence of native host behavior.

Screenshots are in `../evidence/frontend-qa-2026-11-08/root-round2-*.jpg`. Gallery pair uses the same outer2560×1267 viewport and same982px modal presentation. Native host navigation reduces app-content width, so whole-page pixel equality is not asserted. Demo4different shirt views versus nativehoodie3photos is a fixture difference;37entries for3actual assets is the defect.

## External rollout during this round

The development web image changed outside this campaign to `sha256:001ffe0481d65cc6e630d8fe92e7191f4af84b9cd6a318abc6c324df1f2d21c7`, started22:05:03.241965219Z. A fresh editor via the Products row exposes the PR253 UUID modal and correctly closes Addviews using X, Escape and Cancel. Hidden zero-size leftover DOM nodes do not intercept the header; DOM hit-testing confirms the header is uncovered. Old already-open pages retain old assets and their earlier scrim result remains historical. The current compiled selected-product bundle includes the PR254 decoder marker, but the filechooser test stopped before a file could be selected, so successful native upload is still unverified.

## Current first-save recovery

On the fresh current-build hoodie page, added one Front view and clicked Save draft. The native action dispatched and ended in the unconfirmed-write state. One original-request Retry produced the same state. A scoped development READ ONLY query found a new config with draftversion1, updated22:18:23.756Z, but zero selectedSetupviews. The initial scaffold is present; the desired one-view draft has not been confirmed. The local view remains visible and Save draft is disabled while custody is pending. RecordedQA-013, relatedtoQA-002withoutassertingasharedcause. No new or changed operation replaced the original intent.

## Buyer quantity discrepancy

Luna's fresh empty-cart session successfully added one Zwart/XS customized item at17.45USD. Increasing quantity to2inShopify and reloading showed9.95unit/19.90total with no review warning/entry; root independently observed the same current native cart. Restoring1returned17.45andthecustomizedreviewentry. Luna then removed only its line and verified a fresh empty cart. RecordedQA-012. We did not click Checkout. A direct browser navigation to cart.js was blocked by the browser; no bypass or carrier-value extraction occurred, so the exact server/carrier cause remains unknown.

## Test-method references

[Playwright best practices](https://playwright.dev/docs/best-practices) supports testing user-visible behavior, isolated state and semantic controls. We apply those principles through the available CUA browser controls rather than treating source selectors as passing UI tests. [Stately testing](https://stately.ai/docs/testing) and [graph paths](https://stately.ai/docs/graph) inform the state/transition inventory; this does not add XState or replace existing reducers. The approved demo remains the behavior/presentation oracle. Production-only states need controlled service-result tests and separate native replay.

## Final independent replay and visibility finding

The new clean quantity-1 and quantity-2 screenshot pair confirms the displayed USD17.45→USD9.95 unit change from a fresh current Designer. The customized-cart review entry changed1→0 in DOM, and restored atquantity1. Checkout was not used. Only the owned line was removed; fresh cart main was empty with zero cart tables. See round2-report.md for the actual pair and exact limits.

Mixed cart screenshots are a separate real defect, QA-015. A prepared iframe becomes visibility:visible inside its closed hidden inert parent. It paints over the native cart without customer activation; natural preparation expiry restores normal pixels. Same-frame DOM evidence and independent Sol source review support this. Do not use mixed screenshots to prove cart prices or clean empty-cart pixels.
