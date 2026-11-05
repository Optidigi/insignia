# Variant image flow review

Independent browser and pixel review by the Sol flow agent, 27 October 2026. Scope is the loopback merchant preview for the T-shirt product `15464675246464`. No production or Shopify data was changed.

The browser test is `apps/web/test/admin/placement-variant-photos-browser.test.mts`. It uses the existing preview host, the pinned Polaris runtime, native Polaris selection controls and actual garment photography. The refreshed browser run passed in 28.7 seconds after the inline review action, image error handling and sticky bulk scope text were integrated. It produced 41 screenshots covering 15 states.

## Observed behavior

- Variant images opens inside the existing View settings inspector. The section names its view, such as Front images, and the existing base-photo action says Change shared image.
- Black and White can be selected with native checkboxes. The image picker assigns one image to both groups. Its action reports the selected group count.
- Assigning the correct Black front image from the unassigned example requires alignment confirmation and persists through Save draft. Query example keys keep the local examples separate.
- Switching Black to White changes the actual canvas pixels. The selected colour also changes the outline thumbnails.
- Missing Black / Back shows Image needed. It renders no substitute canvas image, and Publish opens Finish setup before publishing with the actual Black / Back issue.
- The explicit image-error example shows Image unavailable, Retry and Change. Publish is blocked. Choosing the valid Black front image clears the failure, and Review opens the canvas for successful alignment confirmation.
- Colour and Fit produces distinct Regular and Relaxed groups. Each row correctly counts four size variants. The grouping editor uses the existing product options. This is a layout fixture that reuses the colour photos for both fits. It does not represent separate fit photography or Shopify inventory.
- A group area edit changes the Black assignment while preserving every shared view and placement. Undo restores the previous geometry; Redo restores the edit.
- Searching the large example reduces the list to its matching group. Keyboard Space selects the focused native checkbox.
- The app document has no horizontal overflow at 1440, 390 or 320 pixels.

## Pixel observations

Desktop presents the photograph, artwork areas and inspector together. The group area inspector explicitly says Alignment for Black and offers Use shared area. At phone widths the variant rows retain their thumbnail, label, variant count and row action without horizontal clipping. The native image chooser and publication review dialog remain usable at 320 pixels. The fit list scrolls vertically while its rows remain readable.

The first rendered review exposed a blank product canvas despite successfully loaded row thumbnails. The loopback HTTP URLs did not satisfy the renderer's existing image URL contract. The integration agent changed the local samples to the existing reserved HTTPS demo origin and its service-worker transport. The subsequent captures show the actual White and Black garments.

The initial short-phone alignment finding is closed. The inspector now has a Review action for the affected group. It opens the real canvas with Check Black on Front and Confirm alignment.

The bulk-scope finding is also closed. The picker names Black and White and the total of eight variants. Its sticky summary remains visible at 320 pixels after selecting the lower Navy radio. The browser assertion checks that the summary stays inside the visible modal bounds, and the refreshed short-phone screenshot confirms the actual text. No material flow or clipping findings remain in the reviewed states.

## Evidence and limits

The final refreshed captures and `manifest.json` are under `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/variant-photos/`, separated into desktop, mobile and narrow directories. Captures exclude the preview's local demo controls. The test intentionally exercises a contrived bulk assignment without capturing its resulting mismatched colour as a normal product state. Alignment captures use a valid Black front assignment.

These results establish local preview behavior and rendered composition. They do not establish native Shopify admin appearance, deployment, owner acceptance or release approval.
