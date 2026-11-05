# Storefront setup research

Checked 26 October 2026. Research and UI recommendation only. No application, theme, account or configuration changes; no native Shopify setup was exercised.

## Ownership and documented flow

Shopify owns the theme editor. Merchants add, remove and position app blocks in its Apps section, edit their settings, and activate embeds in App embeds. They preview changes before saving and publishing. Insignia owns clear post-install instructions and the handoff into those controls. Shopify recommends theme-specific onboarding and an explicit unsupported-theme message where needed. Keep editor settings mainly visual. [Shopify theme extension UX](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/ux)

Installation alone neither adds app blocks nor activates embeds. Deep links open a proposed block/embed in the editor for preview before the merchant saves. App blocks need JSON templates and sections supporting `@app`; embeds also work in vintage themes. Links use the app API key and Liquid filename handle. `mainSection` targets the template's main section; incompatible sections can fall back to a template-level block. A missing template or block limit can still prevent setup. [Configuration, compatibility and deep links](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration)

`shopify.app.extensions()` provides read-only extension information, including block/embed handles, availability status and placements with theme IDs. Theme activation data covers the published theme only. App Bridge is not versioned with Polaris. [App API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api) This check requires no additional access scopes. [Detecting app blocks and embeds](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration#detecting-app-blocks-and-app-embed-blocks)

## What Insignia already has

[StorefrontSetup.tsx](../../../apps/web/src/islands/StorefrontSetup.tsx) already links to the current theme editor with `template=product`, `addAppBlockId=<apiKey>/customize`, `target=mainSection`, and separately `context=apps`, `activateAppId=<apiKey>/cart-repair`. These match Shopify's documented handoff. It has instructions and a manual editor fallback, but no activation query or measured completion state.

[customize.liquid](../../../extensions/insignia-theme/blocks/customize.liquid) emits the buyer element and offers button-label and proxy-prefix settings. [cart-repair.liquid](../../../extensions/insignia-theme/blocks/cart-repair.liquid) is a `body` embed. The existing copy claims the button appears only for an available published customization; that is not established by this code. [element.tsx](../../../apps/storefront/src/element.tsx) creates the trigger on connection and loads the buyer code on click. Do not repeat the hidden-button claim as verified behavior.

## Proposed small V1 UI

These are design choices, not additional Shopify requirements.

Keep one compact **Storefront setup** page with two setup rows and a final test:

| Task | Action and supporting copy |
| --- | --- |
| Customization button | **Add to theme**. Position the block near purchase controls and save in Shopify. If already active, use **Open theme editor**. |
| Cart review | **Enable in theme**. Enable the cart review embed and save in Shopify. |
| Customer test | **Preview a configured product**. Use a published Insignia product configuration, complete a design, add it to cart and check cart review. Link to product setup if needed. |

Product configuration and theme installation can happen in either order. Require a configured product for the final customer test, without making it a prerequisite to adding the block.

If activation checks are added, label their scope **Published theme** and recheck automatically on return from Shopify. Do not add a routine refresh action; offer a contextual retry only if verification fails. Use precise states such as active, not active, unavailable and could not check. Do not equate `unavailable` with incompatible theme. Refresh after returning from Shopify; a link click or return is not completion evidence. [App API status definitions](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api)

A saved draft theme remains separate from the published theme check. Activation is not proof of correct position, all product-template coverage, product readiness or a working customer journey. Keep the final test visible. For an unsupported template/section, explain the limitation and offer the editor/manual route to a compatible product template or section. Do not claim the cart embed alone makes an incompatible product theme supported. These limits follow from the documented compatibility, template-specific placement and published-theme status scope above.
