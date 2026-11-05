# Adaptive quantity entry

2 November 2026. Implements the owner's approved compact-row example in the selected sibling `designer-prototype` customer modal. The [research](adaptive-quantity-entry-research-2026-11-02.md) distinguishes Shopify's ordinary selector and quick-order patterns from Insignia's automatic layout decisions. No backend setting, product classifier, new cart page or live Shopify write was added.

## Behavior

`quantity-layout.ts` is a pure presentation policy. One configured tuple gets one quantity. Up to six configured tuples with at most three column values use compact rows with editable decrement/increment controls. Larger sets retain direct-entry grids. Column labels over twelve Unicode code points use a vertical quantity list; more than twelve values in that layout enable search. These thresholds are local presentation choices, not Shopify requirements. Stock and entered quantities do not determine the layout.

`quantity-entry.tsx` renders these presentations with the existing themes and quantity events. Values remain in the designer reducer. A quantity entered in a previously unused row now adds that row atomically, so it survives Review and commit. Quantity focus updates only the preview row and never removes other unfilled groups. Group names and counts have separate space so long names wrap without splitting the count.

Compact rows show actual supplied tuples. An absent exact grid slot has no quantity input; an existing unavailable tuple has an unavailable state. Legacy fixtures establish explicit availability without claiming unknown unavailable tuples exist. Three-axis names and identities remain intact through the existing adapter. No title parsing, translated-name classifier or invented swatch is used.

Saved quantities for unavailable, absent or retired options appear in a shared recovery section. Remove deletes only an existing quantity key. Valid selections remain intact, focus returns to the remaining control, and Review is blocked until unavailable entries are removed. With no available options, the page states that plainly and disables Review.

Search keeps positive and invalid entries visible. A focused field stays present while its value is cleared and retyped, even if its label does not match the search. Responsive wrapping and Review/Edit preserve quantities. Native bad numeric input is invalid, rather than silently becoming a valid zero; deliberate empty input means zero. Invalid and non-finite quantities cannot enter a committed design.

## Verification

The maintained browser test exercises all fourteen shipped scenario configurations at 1440, 390 and 320 px. Each enters a quantity, resizes, opens Review and returns through Edit quantities. The ordinary 390 captures use dark appearance; 1440 and 320 captures use light. Additional cases cover twenty long model labels with filtered editing, sparse actual tuples, three supplied axes, retained unavailable and unknown selections, and no available options. These are local synthetic configurations, not observations of real store inventory.

Under Node 24.21.0:

- Configuration and quantity-policy/reducer checks: 74 passed. The five new quantity checks run through the existing `check:configs` command as well as the focused `check:quantities` command.
- Exact variant adapter: four passed. Runtime and cart-port contracts: 17 passed.
- Maintained customer browser, artwork preview contract and launcher: 27 passed, no skips. The cross-product browser case contains 42 scenario/viewport journeys.
- Selected customer strict TypeScript/production build, merchant admin-test strict TypeScript, source coverage and targeted repository formatting/lint passed. New sibling modules, the focused check and affected stylesheet were formatted; no dependency was added.

The reviewer found and we corrected four workflow issues before delivery: lost empty group membership on focus, missing removal of retained unavailable entries, fabricated inputs in absent grid slots, and filter-driven focus loss on clearing. The partial-number normalization gap was also corrected and browser-tested.

Independent [logic review](adaptive-quantity-logic-review-2026-11-02.md) reports no active findings. Independent [actual-screen review](adaptive-quantity-screen-review-2026-11-02.md) inspected twenty initial captures and the final long-name, three-axis and unavailable-state corrections. Its count-wrapping finding is resolved. Neither review establishes owner acceptance or native Shopify qualification.

Fresh screenshots and logs are under `/Users/pc/Development/Insignia/.artifacts/adaptive-quantities-2026-11-02/`. The refreshed review gallery leads with eight adaptive states, including desktop and phone versions where supplied. It contains 337 states and 571 screenshots overall. Earlier quantity captures for the small sparse example were replaced so the gallery no longer shows its superseded matrix.

## Limits

The selected frontend remains unconnected to Shopify. Local sample prices, photos, option labels and receipts remain synthetic. Layout does not establish stock quantity, quantity-rule minimum/increment, contextual prices, physical compatibility or calibration. Those still depend on explicit data and the existing authoritative integration boundaries. This change did not add the separate large-catalogue selected-variant picker discussed as a possible future pattern; large short-labelled sets retain the existing group picker and direct entry, while long-labelled columns use the new searchable list.
