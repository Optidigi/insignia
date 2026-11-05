# Customer artwork positioning

23 October 2026. Original non-masking UI preview on port 62168. The masking worktree is unchanged.

## Implemented in the local admin UI

Customer options now has an enabled public Polaris switch, Allow customers to move artwork. The per-placement `customPlacementAllowed` boolean defaults to false when reading old drafts and for newly created placements. The setting follows the existing draft/history/save/discard flow and independent duplicate/view/cross-product copies. Cross-product copies still require their destination image and alignment review. The option survives local publication snapshots; subsequent draft changes do not alter the published snapshot. It does not change method prices or decoration sizes.

This is saved local UI behavior. Production published configuration, buyer design/quote identity, accepted snapshots, renderer output and checkout contracts have not been expanded. Customer drag-to-position is not implemented by this switch. The next customer UI pass should prove that interaction before production wiring, consistent with the existing frontend-first workflow.

## Recommended customer UI

The existing customer designer is in sibling `designer-prototype`, running on port 5173. The accordion example opens two sample artworks and the Left chest card. No customer-source files were changed in this pass.

Keep Artwork → Sizes & quantities → Review. Add a secondary Adjust position action directly below Width in the expanded placement card. Show it only for enabled placements with usable artwork and valid image/area geometry. Default to the merchant's suggested center; the normal flow continues without opening this tool.

On desktop, activate the existing preview with the allowed boundary visible, while the card shows Done, Cancel and Reset position. On phones, temporarily expand the existing preview area for the task and keep those actions reachable. Drag/touch moves the artwork; arrow-key nudges and labeled directional buttons provide alternatives. Do not require X/Y fields or expose rotation/free resize in the first version. Width remains the existing priced choice.

Constrain the entire artwork footprint to the approved area, including its actual aspect ratio. If a selected size leaves no room to move, explain that rather than showing an ineffective action. A later width/image change must revalidate position. Retain positions per configured placement, not as a shared global offset. Artwork-to-follow keeps the merchant default and does not expose a positioning tool without artwork.

Review should show the resulting thumbnail and a subtle Custom position marker with its existing Edit route. The chosen coordinates must eventually become validated design data, participate in the quote/accepted design identity and reproduce the production output. A display-only transform is insufficient for an orderable feature.

## Evidence and decisions

Three independent Luna xhigh reviews covered workflow twice and code/data propagation once; the root checked their conclusions against the current code and actual desktop/390px browser DOM/screenshots. The ambiguous placeholder name Allow custom placement was replaced with a concrete action. The boundary and fixed-price/size policy were retained; there is no product-wide alternate editor or mandatory extra wizard step.

- [Shopify Switch](https://shopify.dev/docs/api/app-home/v2.0/web-components/forms/switch): supported controlled binary control with associated details. The owner's theme-editor-style staged settings convention remains.
- [Shopify visual editor layout](https://shopify.dev/docs/apps/design/layout): merchant layout reference; the customer designer retains its own established presentation.
- [Customily movable text](https://help.customily.com/articles/6004583164-movable-text-allowing-customers-to-move-the-text): merchant-defined starting state and a constrained shopper movement area. This source describes text; it supports the boundary pattern, not an image-feature implementation claim.
- [Printful Design Maker](https://help.printful.com/hc/en-us/articles/50264129164305-How-can-I-transform-a-design-in-the-Design-Maker): direct manipulation plus precise controls. Its wider editing feature set is not required for this MVP.
- The refreshed Vercel interface checklist informs keyboard/touch alternatives, visible focus and viewport-safe actions. Shopify governs merchant copy and component contracts.

43 targeted model, storage, publication and copy checks pass. The customer-policy browser workflow passes at 1440, 390 and 320 widths, including Undo/Redo, toggle-back-to-clean, save/reload, discard and per-placement independence. The existing artwork-policy and header-action workflows also pass. Strict admin TypeScript, scoped Biome and pinned Polaris 2.0 RC validation pass; artifact `artifact-886dd1ea-63c1-42f2-9f1c-7295863528f9`, revision 1.
