# Frontend recovery independent Sol review

28 October 2026. Scope: the authorized Storefront test return, production buyer cart-review status, and unsupported saved-setup guidance. This review covers production source, actual callers, local fixture browsers and rendered 1440/390/320 px states. It does not qualify native Shopify integration, deployment, or owner acceptance.

## Sources and review boundary

I read `AGENTS.md`, the project UI delivery, code-review and TDD skills, current state, the affected implementation-plan contracts, and the consolidated and individual buyer, Settings/cross-flow, and persisted-merchant audits. Shopify's installed App Home guidance governs merchant components and state copy. Checklist Design's bundled Settings, Adding to cart and Showing input error checklists supplied the state and next-action questions. Their unrelated account, security and billing-management items remain Shopify-owned or intentionally deferred.

The review is limited to this follow-up within the existing dirty working tree. It does not attribute unrelated working-tree changes to this assignment. I did not edit application or test source, run a build, or write to a provider.

## Standards

No material standards finding remains in the final reviewed scope. Merchant recovery uses the existing Polaris banner, actions, request workflow and silent form skeleton. The buyer keeps its independent Shadow DOM presentation and request/reducer ownership. No schema, publication, payment or support-link contract was added.

The Storefront return accepts only the exact internal route, validated numeric product identity and known task fragment. Duplicate product identities, credentials, unknown controls, alternate origins and fragments fail to the existing Products destination. The editor's actual breadcrumb label and destination both identify Storefront setup. Returned identity remains picker preselection until explicit selection and a fresh authenticated eligibility read.

## Spec and corrected review findings

No material spec finding remains after correction.

During source review, I found that the first direct saved-cart action passed `retained.current` into `review()` before the asynchronous cart and cart-state reads. The subsequent price proposal could therefore use old quantities or reintroduce a design removed externally. The implementation agent reproduced quantity and removal failures, then replaced the captured array with a review intent resolved from freshly restored groups. The existing remove-design path now uses an explicit intent and refuses a changed editing fingerprint. Independent final browser checks verify current quantities and omission of removed designs in the proposal. Complete external removal yields no proposal. None of these review actions applies a cart mutation.

I also requested explicit focus handling when recovery actions disappear. Unsupported setup reload now focuses the loaded setup heading, or the recovery/status destination selected by its result. The independently run merchant regression verifies the successful-load destination. The buyer now focuses the actual price-review heading when the saved-design button disappears, rather than the preceding warning heading. Its final browser regression checks that focus destination.

Cart-review status follows current request-fenced observations, survives editing and failed reviews, and clears after an authoritative clear observation or acknowledged application/removal. A signed offer or price proposal alone does not claim that the cart was repaired. An empty cart and unrestorable designs in a nonempty cart have distinct outcomes. Existing in-progress designs keep the complete review path instead of being omitted by the shortcut.

Unsupported persisted setups still fail closed. The warning says the saved setup has not changed, offers a real authenticated reload and contextual return, and directs persistent failures to Insignia support without inventing a URL or destructive reset. The form, Create, Save and Publish actions are absent while the stored setup cannot be opened. Reload visibly enters the existing loading state and makes no write.

## Rendered review

I inspected the actual cart notice at all three widths, plus its pending, failed and price-ready states at 320 px, under `/tmp/insignia-cart-repair-captures/`. The warning precedes editing, its action is visible without scrolling on phones, and its text/actions have clear insets with no horizontal clipping. Pending disables the action; failure preserves retry; price-ready keeps the warning until the cart is actually reconciled. The final 320 px price-review capture was inspected after the focus correction.

I inspected Storefront return-confirmation captures at all three widths and the unsupported banner captures under `/tmp/insignia-recovery-merchant-captures/`. The return state shows a concise confirmation task without reviving an unrelated cached product or claiming publication. The unsupported warning and both recovery actions wrap cleanly at 320 px.

The standalone merchant fixture omits the native host title bar and stubs icons, so it only establishes content layout. I separately inspected `unsupported-host-1440.png`, `unsupported-host-390.png` and `unsupported-host-320.png` from the explicit local preview host. Those show the real warning glyph and host framing. There is no remaining concrete pixel finding in these changed states. These are local simulations, not native embedded Shopify observations.

## Independent verification

All commands used Node 24.21.0 from the relevant application directory against the final artifact/source released by the implementers. I ran no broad suite or build.

| Command | Result |
| --- | --- |
| `node --test test/admin/return-path.test.mts test/admin/storefront-product-test.test.mts` | 17 passed, 0 failed |
| `node --test --test-name-pattern='unsupported saved setup\|storefront product testing' test/admin/editor-browser.test.mts test/admin/storefront-product-test-browser.test.mts` | 2 passed, 0 failed |
| `node --test test/buyer-state.test.mts` | 13 passed, 0 failed |
| `node --test --test-name-pattern='a cart requiring review\|a fresh cart observation\|cart review guidance\|saved-design review\|unrestorable designs\|removing a saved design' test/buyer-browser.test.mts` | 8 passed, 0 failed |

The merchant browser checks exercise blocked session storage, actual editor navigation, returned task focus, picker preselection, fresh verification, unsupported read-only controls, loading and successful reload focus. Repeated unsupported and failed-reload focus branches were source-reviewed, not separately exercised by that focused case.

The eight cart cases exercise direct saved-design review, pending/error/retry, price-heading focus, fresh repair observation, preservation of an in-progress design, external quantity and design removal, complete external removal, nonempty unrestorable recovery, and removal's changed-cart guard. Observing or proposing prices makes no cart mutation. All 40 independently executed checks passed.
