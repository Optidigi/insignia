# Independent preview and matching flow review

27 October 2026. Independent source and rendered review completed for the three authorized improvements. No material correction remains from this pass. This is local review acceptance; owner acceptance, backend integration, native Shopify checkout and deployment remain separate.

## Review scope and evidence

Read AGENTS.md, the saved Insignia UI delivery workflow, admin UI guidance, the latest combined persona audit and independent persona evaluation. Reviewed the current placement editor, variant-photo model and examples, buyer prototype preview context, StorefrontProductTest and its publication/link model. Read Shopify App Home guidance for the selected Polaris 2.0 RC runtime and 2.0.0-rc.3 types. Used Checklist Design Saving changes and Modal checks and current Vercel interface guidance as supplementary lenses. No app source, merchant records or shared live tabs were changed.

Inspected the prior 320 px published-product Storefront setup capture at `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/storefront/narrow/settings-storefront-test-published.png`. Its separate Published theme and Test the customer flow sections, local product status, Change product action and theme-editor destination are the composition baseline. This prior capture is reference evidence only.

## Source facts and review criteria

The artwork preview opens a frozen current draft, including unsaved local edits. Current draft must remain the source label even immediately after local publication. A route to Storefront setup must explain that the theme test uses published customizations; it cannot imply that draft edits appear there. Existing activeRevisionId verification must remain the eligibility check.

The placement editor's document click guard covers real same-origin links that leave its route and opens Leave without saving. A same-tab Storefront setup link should use that guard. Product context should override unrelated cached test selections, while a failed or unavailable context must remain recoverable through the existing product picker.

Shopify's current variant-image documentation says each variant has one assigned image. Product gallery order does not provide a verified Front/Back association. Matching can propose existing assigned photos for the selected view with merchant review. It must not claim that one-image associations recover a whole multi-view image family. Existing image assignments, explicit shared-image choices and custom placement rectangles require preservation. Missing, unsupported and conflicting associations must remain unresolved and offer manual assignment.

## Sources

- [Shopify variant images](https://help.shopify.com/en/manual/products/product-media/add-images-variants)
- [Shopify content guidance](https://shopify.dev/docs/apps/design/content)
- [Shopify App Home save bar](https://shopify.dev/docs/api/app-home/v2.0/app-bridge-web-components/save-bar)
- [Checklist Design saving changes](https://www.checklist.design/flows/saving-changes)
- [Checklist Design modal](https://www.checklist.design/design-system/modal)
- [Vercel interface guidance](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)

## Completed preview-purpose pixel pass

Viewed customer-preview, editor-storefront-test-action, storefront-editor-product-confirmation and storefront-verified-product captures at 1440, 390 and 320 px under `/tmp/insignia-preview-purpose-2026-10-27`. The persistent evidence destination is `.artifacts/admin-popup-review-2026-10-24/preview-purpose`.

Artwork preview · Current draft is readable above the product name. Desktop and 390 px show Decoration size beside the Embroidery method, directly resolving the prior terminology defect. The 320 px initial viewport ends below the Decoration size heading, so it does not establish below-fold size-control appearance. No changed-label clipping appears above that boundary. The editor menu's Test on your store destination fits at every tested width.

The Storefront confirmation state visibly focuses Test the customer flow and asks the merchant to choose a product. Confirmed native selection then shows Customizations published and Preview in theme editor, with the existing cart-review steps. Unknown published-theme status remains Not verified with a manual-check banner. It does not claim that the published theme is fully configured or that the draft snapshot appears in that test. This matches the prior Storefront reference composition. No material visual finding in the preview-purpose or route destination states.

The source transports a validated numeric product identity only, suppresses unrelated cached product selection, and seeds the native picker. The confirmed picker supplies the product handle/template; the existing authenticated activeRevisionId check remains required before a preview URL is offered. This is an honest boundary for product context. Root reports a passing browser check for the dirty-draft Leave without saving path after correcting the host menu guard. I did not independently operate the shared browser.

## Completed matching source pass

The matching model distinguishes missing, incomplete, conflicting and unavailable source associations, leaves every existing assignment record intact, and rejects stale review signatures. It applies only selected suggestions to the selected view. New images still require alignment review. The UI waits for thumbnails to load before selection, exposes failed-image retry, offers updated review after source changes, and returns focus to the matching entry after Cancel or Apply. Existing image-list assignment remains the manual recovery path. Ordinary fixtures without source associations do not offer the action. Synthetic association fixtures cannot establish a connected Shopify import.

## Completed matching pixel pass

Viewed desktop entry, review, enlarged image, selected matches, applied result, stale review, conflict, missing associations, kept setups and no-source states. Viewed mobile and narrow review, enlarged image, selection, applied result, conflict, missing associations, kept setups and no-source states. Also viewed the mobile failed-image and recovered-image states. Evidence is under `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/variant-photo-matching/{desktop,mobile,narrow}`.

The review fits the existing image panel and names Front in its heading and selection instruction. Photo thumbnails and their enlarged previews let the merchant check the proposed view instead of trusting filename guesses. At 390 and 320 px, labels wrap inside the panel, selection counts remain beside the group of choices, and Cancel or Back to images plus Apply remain reachable without horizontal clipping. The enlarged photo stays within the narrow screen. The applied state retains Review and Change, shows Check alignment per new assignment, and leaves the unselected group Image needed. Matching does not silently confirm alignment.

Conflict, partial association and unavailable source rows remain unselectable and give specific reasons. Kept image and custom-setup rows have no replacement checkbox. The no-source state omits matching and retains manual Add actions. The failed-image state shows Retry and excludes that image from the apply count while the other two remain usable. After retry, the restored image is selectable and the count can include it. The stale desktop state visibly disables Apply and offers Review updated images. No material visual or recovery correction remains.

## Verdict and verification limits

1. Decoration size and Artwork preview · Current draft resolve the observed terminology and source ambiguity. The draft preview remains an artwork task.
2. Test on your store leads to the existing Storefront setup test. Native product confirmation and authenticated publication verification preserve the destination's published-product meaning. The editor's dirty-draft recovery remains required and root reports its focused browser test passed.
3. Reviewed matching is useful within actual variant-image associations. It preserves existing assignments and alignment exceptions, leaves uncertain data unresolved, and requires image inspection and later alignment review. It does not establish an automatic Front/Back mapping or live Shopify synchronization.

Root reports the complete 1440/390/320 matching browser sweep, mobile image recovery, model and relevant regression checks, strict types and pinned native component validation passed. I reviewed source and actual captures independently; I did not rerun those tests or operate shared browser tabs. Static captures do not establish keyboard behavior, connected checkout or production publication. No additional cart, global settings or backend work is required for this authorized UI scope.
