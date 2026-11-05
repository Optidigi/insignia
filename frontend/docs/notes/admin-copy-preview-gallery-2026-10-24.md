# Copy review, customer preview and admin screenshot inventory

24 October 2026. Original non-masking loopback UI. The owner accepted Add views; its implementation was left unchanged.

## Copy review

The title stays “Copy setup to products” through destination selection and review. Selected view rows now have separate rounded surfaces without dividing lines. Up to three destination products remain inline. Larger destination sets show their total and a collapsed “View selected products” disclosure. More than ten recipients add search and ten-row paging inside that disclosure; these controls inspect the already selected recipient set and cannot silently change the copy scope. The modal body owns scrolling and its native footer remains available.

Three fresh independent Luna max reviewers examined copy scale, Methods dialogs and Orders/Settings dialogs. Their independent follow-up reviews found two customer-preview adapter defects—partial drafts being rejected and unavailable method/size combinations falling back silently—which were corrected before final verification. Reviews informed implementation; they are not evidence of owner acceptance.

The 50-recipient test renders the real copy review and destination components in the public Polaris modal. It is a layout fixture, not a claim that the three-product demo can copy to fifty verified products. Existing configured/published target protection and staging are unchanged.

## Customer preview

The editor's Customer preview action opens the existing customer designer in a new tab with a frozen snapshot of the current unsaved draft. Following the later gallery feedback, the Products overview exposes Customer preview when exactly one product is selected, in the selection toolbar or phone Actions menu. At phone width, the editor action lives in Editor actions. Opening either preview does not save or publish.

This bridge is gated to the local preview. It uses exact-origin, source-window and nonce validation, one-use listeners and a timeout. The customer adapter validates data, rewrites only the reserved demo image origin, preserves method-by-size availability and contains portrait artwork within the width/height envelope. Ready placements can preview while incomplete ones are omitted with an explicit count. A valid snapshot survives a tab refresh for fifteen minutes; the preview detaches its opener after receipt. It contains artwork configuration, without fabricated product base prices, customer variant options or checkout. No production storefront integration is implied.

## Review artifacts

The workspace-root `.artifacts/admin-popup-review-2026-10-24/` contains `index.html`, the portable `all-popups.json`, `admin-popup-screenshots.zip` and, after the [gallery comment follow-up](admin-gallery-comments-2026-10-24.md), paired screenshots for 81 captured states / 162 images. Desktop is 1440×1000; phone is 390×844, with an explicitly labeled 320×568 upload check. The gallery covers Product editor, Products, Orders, Methods, product assignment and Settings, including relevant empty/error/loading and inline states. Native operating-system select lists, tooltips and externally hosted Shopify dialogs are excluded. The draft-status popover's phone capture is explicitly labeled as opened on desktop before resizing because its trigger is hidden on phones. Extra customer-preview images show the real designer and Products quick action in both sizes.

The live read-only gallery is served at `/__preview/popup-review/` on the original loopback host. Its URL allows only the gallery HTML and known screenshot filename patterns. Captures use isolated browser contexts and local fixtures; the owner's original saved movement area was preserved.

## Verification

- Copy staging, ten-view review and off-page target selection: three focused browser checks pass.
- Fifty-recipient layout, search, pagination, footer and scope preservation at desktop, 390px and 320px; full editor inventory and measurement utilities: three capture tests pass.
- Methods inventory: 26 states in both sizes; Orders/Settings inventory: 24 states in both sizes. Remaining editor captures provide 28 states. All final manifest image paths and dimensions were checked.
- Customer preview: desktop and mobile end-to-end check passes for unsaved edits, portrait artwork containment, snapshot refresh, explicit save and the overview entry point. Three launcher/readiness checks pass; 62 customer config/model checks pass. Existing bounded artwork positioning also passes at 1440px, 390px and 320px.
- Production web build, strict admin-test types and scoped Biome pass. Public Polaris validation passes for the changed destination, copy dialog, editor action and Products action contracts. The requested `2.0-rc` documentation catalog resolves to `v2.0`; runtime and types remain pinned to their existing RC versions.

Polaris component checks validate public properties, not custom visual quality. A preexisting private ScrollBox console error was observed in isolated gallery capture despite successful render and interaction; this pass does not claim a clean global console or a full regression suite. The gallery is for owner review; screenshots do not imply approval or deployment.
