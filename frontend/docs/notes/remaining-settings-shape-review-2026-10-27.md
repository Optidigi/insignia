# Remaining Settings shape review

27 October 2026. Independent Sol source and pixel review after the owner deferred the customer-data UI. Current scope is the three-destination hub, Billing, App permissions and Storefront setup. I made no application changes.

The remaining pages have a clear, appropriately small shape. I found no remaining material composition defect in the inspected final states. This is local source/pixel review, not native integration, owner acceptance or release approval.

## Reference comparison

I freshly opened and expanded Shopify's actual [Settings template](https://shopify.dev/docs/api/app-home/latest/patterns/templates/settings), inspected its rendered desktop and narrow example, and saved readable evidence under `.artifacts/settings-clarity-2026-10-27/shopify-settings-template-reference.png` and `shopify-settings-template-reference-mobile.png`. Its external group headings, contextual descriptions, rounded section bodies, title/status rows, dividers and full-width explanatory body text inform this review. The example's account, currency and notification controls are sample product content, not missing Insignia features.

I also opened the actual saved interstitial-navigation reference at `.artifacts/settings-hub-2026-10-27/shopify-interstitial-reference.png`. The final hub follows its padded text-and-chevron rows, inset dividers, rounded hover and focus space. The three current destinations need no extra group heading or decorative icon tiles.

## Final shape assessment

- **Hub:** Storefront setup, App permissions and Billing are the only rows in the final captures. Normal, hovered and focused rows remain legible at desktop, 390px and 320px. The first-row hover and last-row focus respect their rounded bounds. The deferred customer-data destination is absent.
- **App permissions:** The final title-and-badge row with the explanation below is materially easier to read on phones than the former badge column beside the entire paragraph. This follows the reference's useful relationship between a short status header and longer full-width body copy. At 320px some titles wrap to two lines beside longer badges, without overlap or clipped text. Initial, missing, allowed and view-only states preserve distinct app-grant and staff-access facts. The missing-check prerequisite now appears once beside its recovery actions. No additional permissions dashboard or progress control is justified.
- **Billing:** The current-plan summary correctly leads with its status and verified rate/dates, then the owning Shopify handoff. The final unverified warning names verification failure, and the redundant closing verification sentence is removed. Retry and the Shopify destination remain visible at all three reviewed widths. There is no reason to add local billing editors or speculative plan cards. Future Free/two-paid terms remain a separate product decision.
- **Storefront setup:** The two theme tasks and separate manual product test form a useful hierarchy. Active, not-added and unknown states have distinct actions and status language. Current active button copy explicitly says it is added to the published theme and asks the merchant to check used product templates. This resolves the bounded copy concern; it does not claim template-wide coverage or buyer-flow completion. Product preview remains a manual check. No opaque placement-target parsing or extra completion gate is justified by this review.

## Evidence and limits

I opened all 24 final captures under `.artifacts/admin-popup-review-2026-10-24/settings`: Permissions initial/missing/allowed/view-only, Billing unverified, and hub normal/hover/focus, each at desktop, 390px and 320px. Before the final pass I also inspected Billing active/trial/inactive and Permissions product-missing/denied, plus Storefront active at all three widths and not-added/unknown/published-test states. Current source was re-read after the final shape corrections. Superseded four-row hub and old Permissions paragraph-column images are not the final evidence.

Some 320px page content continues below the viewport, as expected; these images establish no horizontal clipping or title/status collision, not every scroll or keyboard behavior. Root reports the gallery and hub interaction checks pass. I did not repeat those tests or observe a real Shopify billing round trip. Billing return/remount freshness remains uncertain host behavior, not a confirmed defect.

The useful opportunities found in this review were the Permissions mobile text shape and duplicated recovery wording, and the repeated Billing verification sentence. The final captures address them. Further changes would need a demonstrated merchant task or a specific visual defect, not another checklist-driven feature list.
