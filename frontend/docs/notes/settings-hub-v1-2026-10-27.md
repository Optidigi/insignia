# Settings landing page V1

27 October 2026. Local implementation of the owner's agreed Settings scope. Changes cover the hub's composition, copy, navigation checks and review captures. Existing child screens, authentication, billing authority, permissions, exports and theme actions retain their behavior.

## Reference and design decisions

The actual rendered [Shopify interstitial navigation example](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/interstitial-nav) was opened and expanded before implementation. Its DOM and visible pixels show an unpadded Section, a 4px native Box inset, 12px padded Clickable rows with an 8px hover radius, a title over a subdued description, vertically centered trailing chevrons, and inset dividers. The readable reference screenshot is `/Users/pc/Development/Insignia/.artifacts/settings-hub-2026-10-27/shopify-interstitial-reference.png`. The first attempt to save a cropped reference captured the surrounding documentation instead; reviewers caught this, and the saved file was replaced with the actual expanded-example screenshot before review.

The hub follows that composition using the existing pinned Polaris 2.0 RC runtime and types. It has four real destinations: Storefront setup, App permissions, Billing and Customer data requests. Native Clickable anchors own the padded interaction area, rounded hover and focus appearance. No custom CSS or new dependencies were added.

One card is a deliberate refinement of the research proposal's possible two groups. With four rows, a Storefront heading above a single Storefront setup row repeated the same information. The host's Settings title identifies the page; no second visible card heading is needed. The native Section retains its accessible Settings label. Leading icon tiles were removed because the reference's text/chevron structure already identifies all four destinations.

The redundant Methods shortcut is removed from Settings. Methods remains in the main app navigation and product-context flow; its intended pricing/default/assignment behavior is unchanged. Hub descriptions name the destination's task without internal implementation copy, unsupported features or a second layer of account controls. No child data is read just to add status badges, and there is no Save, routine refresh, invented support link, illustration or promotional filler.

## Review lenses

The installed Checklist Design Settings checklist was applied to structure and applicability. Account/security controls and uninstall remain Shopify-owned; Billing is a child link; notification delivery remains a separate product decision. A checklist category is not a requirement to invent a control. Fresh Vercel guidelines informed native link semantics, visible keyboard focus, long-content containment and readable narrow layouts. The existing Memorisely grouping/proximity and Zander contextual-disclosure lessons informed keeping supporting descriptions near their destinations and the detailed controls on child pages. Shopify governs component composition and sentence case.

Two independent GPT-6.1 Sol medium agents inspected the corrected readable reference and the actual implementation captures. The design reviewer opened all nine normal/hover/focus images at 1440, 390 and 320px. The workflow reviewer inspected representative normal and interaction captures at all three widths, then checked source ownership, links and child returns. Neither reported a material finding in the final local scope. They explicitly supported the single-card adaptation and removal of redundant decorative icons/headings. These are local review results, not native embedded acceptance or owner approval.

## Verification and evidence

- Web check/build covers 160 files with zero errors or warnings. Strict admin-test TypeScript, scoped Biome and the Shopify pinned 2.0-rc component validator pass.
- The focused hub browser/gallery workflow captures normal, first-row hover and last-row keyboard focus at 1440×1000, 390×844 and 320×568. It measures at least 12px padding inside each rendered native anchor and at least 16px between the clickable area and viewport edge. The four destinations fit the short phone without horizontal overflow or clipped content.
- All four actual padded-area clicks reach their real child routes. Each native host Back to Settings breadcrumb returns to the hub. Sequential Tab navigation visits the four rows in order; Enter opens the selected page. The hub makes zero privileged child-data reads.
- Six existing Settings/permission workflow tests preserve canonical Methods routing and explicit consent boundaries. The focused delayed-Polaris host navigation check verifies that the refreshed hub still opens through app navigation without exposing unstyled controls.
- Captures are in `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/settings/{desktop,mobile,narrow}/settings-hub-{normal,hover,focus}.png`. The dedicated `settings/hub-manifest.json` preserves existing child-page captures; Latest changes leads with the three new hub states.

The first return-navigation assertion looked inside the iframe for a Settings link. Inspection of the actual preview showed the native host labels its return link Back to Settings outside the iframe; the test now exercises that visible control. No child-page recovery behavior was changed to accommodate a test.

Local application and loopback preview only. No Shopify grant, theme Save, plan change, backend feature, native embedded visual acceptance or deployment occurred.
