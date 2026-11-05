# Customer cart state audit and references

28 October 2026. Independent read-only review of the agreed customer frontend at `/Users/pc/Development/Insignia/designer-prototype`. This is not the `apps/storefront` integration UI. Root owns implementation; this initial audit changed no application source, build, browser state or provider resource.

## Existing state architecture

`src/designer.tsx` uses native Preact `useReducer(designerReducer, input, createDesignerState)`. The pure `src/designer-state.ts` module owns design choices, quantities, cart designs, the edited design ID, product/designer routes, modal state, upload ownership and timed recovery. Presentational state such as focused preview and measured image dimensions remains in component hooks. That division does not require another state runtime or moving every visual toggle into the reducer.

Source and the existing `apps/web/test/admin/designer-state-browser.test.mts` establish meaningful guards: a modal blocks a second cart commit; editing replaces its saved design by stable ID; cross-design switching can require a discard decision; product return preserves an unapplied draft; upload results require the active token and target. The existing browser suite also exercises history, cancel and recovery. These are source/coverage observations, not a new independent full-suite result from this audit.

## Scope correction: Shopify owns the customer cart

The initial audit recommended expanding the prototype's local product-return cart section. That recommendation was wrong for the intended product boundary and is withdrawn. The customer customizer opens from a Shopify product page. Successful addition or editing must return control to that host; Insignia should not introduce its own customer cart-management page or a nested cart confirmation that duplicates the host's feedback. Passing local-cart tests does not validate that product decision.

The canonical implementation contracts establish the boundary:

- `extensions/insignia-theme/blocks/customize.liquid` places an `insignia-buyer` trigger in a Shopify section and supplies locale-aware `routes.root_url` as `cart-root`.
- `apps/storefront/src/element.tsx` lazy-loads the customizer after that trigger is used. Its separate cart-repair body embed reads the real Shopify cart.
- `apps/storefront/src/customizer.tsx` emits `insignia-cart-updated` only after `cart.apply` verifies the resulting cart, then completes the workflow. The current integration also exposes a locale-aware native cart link. It does not establish a general theme-drawer-opening adapter or automatically close the overlay today.
- `docs/architecture/implementation-plan.md` §8.4 says the existing complete customized subset is reconciled, ordinary Shopify lines are preserved, and unverified application remains a review-required result. Shopify owns checkout.
- The agreed prototype's README calls `/product` an in-memory return/reopen demonstration and says the real host navigation/embedding mechanism is still unconnected. Its local saved array is test state, not a separate storefront cart authority.

The minimum design is therefore a verified completion outcome (added versus updated), closure/return to the host, focus restoration to the initiating control, and one owner for accessible success feedback. A future host adapter can refresh/open a supported theme drawer or navigate to the locale-aware Shopify cart. Do not promise automatic native-drawer behavior without that adapter. Keep draft cancellation and resumability distinct from a successful commit.

## Initial behavior findings

| Finding before this change | Minimum useful correction |
| --- | --- |
| Confirmation says Added to cart after both an append and an update. The modal stores only `kind: cart`, losing which operation completed. | Retain added/updated outcome and the affected design ID in the reducer result; use that fact for feedback. |
| The existing popup and local return page give the impression that Insignia owns a customer cart. | Return to the Shopify host after completion. Keep a local host stand-in only to demonstrate that boundary while integration is absent. |
| The prototype has local saved-design Edit controls and no Remove action. | This is not a reason to introduce an Insignia cart-management UI. Shopify owns ordinary cart removal; customization repair is a separate integration contract. |
| An unchanged saved design can submit Update cart again, opening another Added to cart confirmation. | Return to the host without fabricating a new update or success event. |

Do not add a fake checkout destination, delayed network animation or live repair warning to hide the unconnected boundary. Keep dirty-switch confirmation, closure and navigation focus under their existing owners.

## References independently read

- [Shopify Dawn cart notification source](https://raw.githubusercontent.com/Shopify/dawn/main/snippets/cart-notification.liquid): the first-party theme template uses an accessible dialog with a close action, product-content region, cart destination, checkout submission and continue-shopping action. This is evidence of host-theme cart feedback, not an instruction to duplicate that notification inside Insignia's customizer. Dawn's checkout form is not evidence that this unconnected prototype can submit checkout.
- [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md): semantic controls, explicit labels, visible focus, safe unsaved navigation, destructive-action confirmation or Undo, empty-state handling and dark-theme native controls inform the review. The guidance does not choose Insignia's cart architecture or authorize a backend behavior.
- Checklist Design's installed [Adding to cart](https://www.checklist.design/flows/adding-to-cart), [Cart](https://www.checklist.design/website/cart) and [Modal](https://www.checklist.design/design-system/modal) checklists were read from their bundled skill files. Relevant items are variant/quantity clarity, feedback after addition, a discoverable cart route, editable/removable items, a clear modal title, close action and responsive actions. Payments, promotions and global checkout remain Shopify/integration responsibilities rather than invented local requirements.
- [Memorisely: Stop Ignoring Visual Hierarchy in UI](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1): the visible transcript groups and prioritizes content before choosing layout, then uses proximity, size and colour to guide attention. It is general hierarchy guidance, not a cart-behavior specification or justification for another cart screen.
- [Zander Whitehurst: progressive disclosure](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX): the author caption supports revealing information according to context. It does not prescribe a separate confirmation. This audit did not attribute commenters' opinions to the author or claim an independently reviewed video example from that post.

The two LinkedIn records were independently opened through their activity URNs, which expose the same author records and IDs as these canonical post links. The Memorisely transcript and Zander caption were available; the claims above stay within that text.

## States still needed when the frontend is connected

The current local commit is synchronous. Actual Shopify integration will need cart bootstrap and restoration, missing/unavailable restored designs, external quantity/removal reconciliation, cart-application failure and uncertain outcome, and checkout handoff. Their loading and recovery states should follow real adapter outcomes. The local cart is not persistent across reloads and is not a whole-store cart; a separate localStorage cart authority would conceal rather than solve those integration requirements.

Five local-cart model tests passed independently before the scope correction. They verify the abandoned local implementation only and must not be presented as proof of the corrected host-handoff experience. Final implementation verification and actual-pixel review remain separate.
