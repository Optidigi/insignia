# Customer UI selection and action alignment correction

28 October 2026. The owner identified two errors in the previous delivery: the review gallery showed the backend-integration buyer instead of the selected customer design, and the unavailable-setup banner's actions were vertically offset. The earlier review did not catch either problem. This record supersedes its customer-design conclusion.

## Selected customer frontend

The agreed customer UI is `/Users/pc/Development/Insignia/designer-prototype`: native Preact, light/dark themes, the existing designer, cart confirmation, product-return page and saved-design editing. `apps/storefront` remains the backend-integration surface and its functional evidence is separate. No customer redesign or backend connection was made in this correction.

The integration warning's `repairRequired` observation can identify changed customized quantities, expired authorization, multiple authorization sets or missing members of a customized set. It is not an additional shopping page. The selected local frontend does not receive that observation yet, so this correction does not invent an always-visible warning, synthetic expiry, automatic repair or price-change rule there. Existing cart return/edit/update behavior already belongs to the selected design.

The gallery now shows actual selected-frontend flows in both themes at 1440, 390 and 320px. Captures were made by adding artwork and quantities, adding a design, returning to the product, editing the saved design and updating it through the real local controls. No reducer was seeded or markup relabeled to disguise the integration UI.

Gallery entries now carry a validated surface classification. Integration checks are excluded when the normalized inventory is generated, including All current states; the previous integration-cart IDs are also excluded for compatibility with old manifests. The integration screenshots remain stored as evidence, not active design states. AGENTS and README explicitly name the selected frontend so future customer-design work does not repeat this selection error.

## Action alignment

The unavailable-setup row combined a native button and a text link in an inline stack using default alignment. It now uses a secondary native reload action and tertiary native navigation action, with `alignItems="center"`. This follows the [Stack alignment contract](https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/stack) and [Button guidance](https://shopify.dev/docs/api/app-home/latest/web-components/actions/button): standalone navigation may be a button, while a link suits navigation within text. Runtime/type validation uses the project's pinned Polaris 2.0 RC.

Rendered DOM measurements show both actions are 28px high, share the same y coordinate and have a zero-pixel center difference at all three widths. The same uncentered mixed-action pattern in the product method-library row is centered. Source inspection of the other reviewed Settings, Methods and artwork-download error states found single actions or native modal action slots rather than this mixed uncentered pattern; no blanket CSS override was added.

## Verification and review

- Selected customer frontend: nine existing browser checks pass, covering all 13 scenarios, desktop/phone, light/dark, cart/edit/history and uploads. Receipt: `/tmp/insignia-ui-correction-designer-tests.log`.
- Eighteen new actual customer captures: `/tmp/insignia-approved-customer-captures/`; source and journey evidence is recorded in `evidence.json`.
- Unavailable setup regression passes with an actual action-center assertion at all three widths. Receipt: `/tmp/insignia-ui-correction-merchant-tests.log`.
- Explicit host captures and measured rectangles: `/tmp/insignia-ui-correction-merchant/unsupported-host-{1440,390,320}.png` and `alignment.json`.
- Merchant build, all 36 effective strict projects, final admin-test compilation, source coverage, formatting and pinned component validation are checked locally.
- [Fresh independent Sol review](customer-ui-selection-review-2026-10-28.md) checks the actual customer captures, merchant alignment and regenerated inventory. It does not equate the earlier integration tests with customer-design acceptance.

The local review gallery remains at [the existing review URL](http://127.0.0.1:62168/__preview/popup-review/). Current captures and integration-only evidence are kept separate. No real cart, order, Shopify setting or provider resource changed.
