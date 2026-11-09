# Storefront modal startup and theme presentation

The merchant's product and product-card surfaces remain Shopify theme UI. The selected Designer runs in its isolated frame inside one owned modal. Startup, failure and recovery are states of that modal, not separate product-page compositions.

## Reported defects and correction

Hidden preparation used `visibility:hidden` on the dialog while the initialized child frame set `visibility:visible`. A descendant can override visibility, so a prepared editor or recovery surface could paint into the theme. Parent opacity containment, inertness and pointer isolation now keep preparation unpainted; showing the modal restores that containment state deliberately.

Cold opening creates the modal immediately with selected header/close chrome and an internal pending indicator. The actual frame adopts that same dialog once configuration arrives. Cancellation, initialization failure and retry retire the correct generation. There is no intermediate dialog to replace, no fabricated product configuration, and no separately displayed loading page. The trigger's busy icon and accessible busy state clear on completion, failure, cancellation and teardown; reduced-motion preferences remain effective.

Theme integration retains the replaced control's visual classes and safely reconstructed decorative SVG. It copies no native purchase handler, submission name, ID or interaction reference. Presentation fallback addresses styles lost when the injected host changes ancestor/direct-child matching; explicit Theme Editor choices remain authoritative. On pointer/focus state changes, fallback compares the unfilled theme presentation with its idle values and yields properties changed by the theme, retaining unrelated ancestor-scoped geometry. Combined idle-background/hover-background/keyboard-focus-shadow and responsive browser regressions cover this interaction. The current Horizon icon-pill/hover layout and representative ancestor-scoped fixtures are the reference cases; arbitrary custom themes still require native qualification.

Recovery keeps its existing safe actions inside the controlled modal and selected panel presentation. A failed or unknown operation must not automatically delete cart lines, replace an acceptance identity or expose another session's designs.

Interaction rescans are coalesced at the next animation frame, after Firefox updates pseudo-state on pointer exit. Automatic and manual placements share abort-owned listeners. Fallback detection samples transition destinations synchronously, then restores the visible starting point before committing final styles with the theme's transition settings. Regressions check intermediate background interpolation as well as final hover/idle values and retained padding in Chromium and Firefox. These are local source-entry proofs, not arbitrary-theme native acceptance.

## Cart investigation limits

The user confirmed that the screenshot followed Designer Add to cart and all designs were in one tab. Read-only order records contain no new completed order matching that report. Existing `cart-state` log entries alone cannot establish the exact cause: the old logger classified a canonical `REVIEW_REQUIRED` error as `UnexpectedFailure` even when HTTP returned the intended409 response.

Local tests and a bounded native same-tab journey passed with black/navy, multiple sizes, three designs, a shared physical variant and an uploaded PNG. The native result was nine garments/five lines/USD179.55; restore passed, and only the captured test lines were removed, with independent zero-item/zero-total readback. No checkout or payment was performed. This does not establish that the user's original failure is fixed or identify its cause.

A separate new-tab ownership probe can produce the recovery surface, but it does not explain the user's confirmed same-tab report. No private capability was moved, ownership relaxed or foreign cart removed. Exact attribution needs a sanitized affected-session trace containing stage, status/code, correlation ID and normalized member counts, not cookies, capabilities, signed carriers or personal/order payloads.

Diagnostics now distinguish the finite `ReviewRequired` class while retaining the same HTTP409 behavior and redaction. Qualification/deployment status is tracked in [delivery state](../delivery/state.md); source tests are not a native deployment claim.
