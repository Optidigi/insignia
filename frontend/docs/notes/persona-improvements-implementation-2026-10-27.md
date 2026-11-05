# Persona audit improvements

The matching portion is superseded by the owner-requested [manual assignment correction](manual-photo-assignment-2026-10-27.md). Artwork-preview and storefront-test changes remain.

27 October 2026. Implements the three owner-authorized follow-ups from the new-merchant persona audit. Local frontend work; no live Shopify writes or production variant-media integration.

## Result

1. Buyer controls and announcements use **Decoration size**, including Embroidery. The editor and Products action say **Preview customization**; its destination says **Artwork preview · Current draft** and preserves unsaved draft content.
2. The existing editor menu adds **Test on your store**, leading to the existing Storefront setup test card with the current numeric product identity. It preserves the dirty-draft navigation guard. The native picker must confirm product metadata, and an authenticated effective published revision is still required before offering the theme-editor URL. It does not fabricate a handle, assume theme readiness, revive another cached product or present draft edits as published.
3. **Match Shopify images** opens within the existing view image panel. Review begins with no selected suggestions. A candidate requires every exact variant in its group to reference the same available product image. Native variant-image metadata does not identify Front/Back; the merchant inspects and selects the appropriate side. Existing explicit, shared, partial and exception-only assignments are all protected. Apply is one undoable draft change and requires subsequent alignment review. Missing, conflicting, incomplete and failed media retain specific recovery; loaded-image gating, stale-plan invalidation, retry, cancel and focus return are covered. Undo now preserves view-settings selection instead of selecting the first placement.

The matching fixtures model Shopify-style source associations using real existing garment photographs. No filename, option label, gallery-order or colour-name guessing was added. Production Shopify source reconciliation remains future integration work.

## References and composition

Shopify governs the native controls and concise merchant copy: [App Home patterns](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns), [content](https://shopify.dev/docs/apps/design/content), and [variant images](https://help.shopify.com/en/manual/products/product-media/add-images-variants). Runtime and validators remain pinned to Polaris 2.0-rc / types 2.0.0-rc.3.

Read the saved [UI delivery workflow](../../../.agents/skills/insignia-ui-delivery/SKILL.md), admin guidance and original persona audit. The independent design reviewer directly compared saved Customily mapping and Teeinblue photo-group examples: preserve explicit source/destination context and compact thumbnail/name/count rows, avoid the blank wizard area, and keep side verification explicit. Checklist Design Table, Checkbox, Saving changes and Modal, plus Vercel interface guidance, supplied selection, focus, scrolling, error recovery and responsive review checks. The existing Storefront test composition is reused.

## Verification and independent review

- Four matching model tests and 18 existing variant-photo regression tests pass. Eight Storefront behavior/unit checks pass.
- Actual browser workflows pass at 1440×1000, 390×844 and 320×568: empty initial selection, loaded-image gating, enlarged photos, cancel without edits, selective application, preserved alignment, stale review after Undo, refreshed selection, Redo and missing/conflicting/existing choices. Failed-image retry/recovery is additionally exercised at 390px.
- Customer-preview and storefront handoff browser checks cover unsaved draft content, Embroidery/Decoration size, native product confirmation, publication verification and the Leave without saving route guard.
- Strict merchant admin-test TypeScript, direct buyer TypeScript, scoped Biome, web build and official pinned Shopify UI validation pass. The full ProductsOverview isolated validator cannot resolve imported selection types; the project build checks them.
- Two independent Sol agents inspected actual source and 1440/390/320 captures, including failures and recovery. Both report no remaining material findings: [design review](variant-photo-matching-design-sol-2026-10-27.md), [flow review](preview-and-matching-flow-sol-2026-10-27.md).

Gallery leads with matching and preview-purpose states. New evidence is in `.artifacts/admin-popup-review-2026-10-24/variant-photo-matching` (30 scenario captures plus live proof) and `preview-purpose` (15 captures). The verified owned 62168 preview was restarted and the live matching screen rechecked. Buyer5173, reference62169 and existing drafts are preserved. Native Shopify checkout, production persistence, deployment and owner acceptance are not established by these local checks.
