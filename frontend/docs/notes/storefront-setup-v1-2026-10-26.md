# Storefront setup V1 — 26 October 2026

## Owner correction: remove synthetic examples

This correction supersedes the media approval and contextual-info-popover composition below. The owner rejected the invented storefront illustrations as a visual regression. Independent Shopify and Checklist Design reassessments agreed: the dark fake customer buttons overpowered the real setup actions, the images did not explain installation, and phone content became unnecessarily tall. Supported component contracts and an available media-card pattern were insufficient evidence of useful design.

Removed the illustration component and media column entirely. Compact task rows now pair status and visible instructions with the real Shopify action. Desktop actions align at the trailing edge; phone actions follow the instructions. Available states explain the exact block/embed setup; unknown states ask the merchant to check the existing configuration; active rows retain purpose and Edit. The shared Save reminder remains visible, and one optional disclosure covers product templates, unpublished themes and compatibility. Removed the two icon-only help popovers because their essential instructions are now inline. Product selection, eligibility, recovery and preview behavior are unchanged.

The [Shopify reassessment](storefront-setup-design-review-2026-10-26.md) explicitly withdraws the earlier illustration approval. The separate [Checklist Design audit](storefront-setup-source-correction-2026-10-26.md) evaluates this independent setup screen rather than imposing a new-user wizard. Fresh rendered review covers desktop, 390px and 320px, including incomplete, active, unknown and expanded guidance states. The refreshed gallery has 15 current Storefront states with 45 desktop/phone/narrow captures; the complete gallery contains 138 states and 275 desktop-phone images. Retired help-popup captures are no longer in the current manifest.

Both focused browser workflows, gallery workflow and hosted-PNG checks pass. Strict admin-test TypeScript, scoped Biome, Astro check/build (zero errors, warnings or hints) and pinned Polaris revision4 validation pass. A pre-existing theme Retry test sampled focus before Preact's effect; the corrected test waits for the actual bounded focus transition, retaining its assertion. No production focus logic changed. Local verification does not establish native Shopify theme Save, deployment or owner acceptance.

## Visual examples and product testing follow-up

The latest revision replaces the text-only task rows with compact product-page and customized-cart examples. Each example sits beside its purpose, status and action on desktop and above them on phones. The illustrations show the actual customer trigger labels without inventing store prices or completion evidence. Placement instructions now use native contextual help beside each task; other-theme and compatibility guidance remains a single shared disclosure. The cart embed's merchant-facing schema name is now **Insignia cart review**; its handle and behavior are unchanged.

Choose a product now uses App Bridge Resource Picker and preserves the selection on this page. An authenticated existing configuration read verifies the selected product's effective published revision before offering **Preview in theme editor**. The preview URL includes the product handle and template suffix. Unpublished products open their own setup and return here through an explicit breadcrumb. Selection cancellation preserves the previous choice, cached metadata requires a fresh check, transient failures offer Retry, and access failures clear the unusable choice. Long product names use the existing overflow detector, a three-line limit and a conditional native full-name popover.

Shopify's [Media card composition](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/media-card), [Resource Picker API](https://shopify.dev/docs/api/app-home/latest/apis/user-interface-and-interactions/resource-picker-api) and [theme extension configuration](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration) informed the composition and handoffs. Read-only inspection of the logged-in Shopify product detail established its actual View template URL pattern: `previewPath=/products/{handle}?view={template}`. Shopify Home provided a native illustration/heading/copy/action reference. The theme editor itself rendered blank in this browser session, so its loaded state and Save were not verified. Checklist Design, Vercel interface guidance and the established Memorisely/Zander hierarchy and disclosure references supplemented Shopify; their application is recorded in the independent review notes.

Independent Sol reviewers rejected the first faint, wireframe-like examples and excessive phone spacing. The final examples have stronger contrast, legible trigger labels and a tighter footprint. Review also caught invalid preview product IDs, then a browser-fixture matcher that still used the old IDs; both were corrected before final capture. The picker now uses verified demo-catalog identities, and gallery assertions require each scenario's exact intended result rather than merely a settled page.

The current gallery leads with **17 Storefront setup states**, captured at desktop, phone and narrow-phone widths: 51 new captures, including 17 narrow proof images. The complete gallery contains 140 states and 279 desktop/phone images. Every generated PNG is checked through its actual hosted preview route. Independent design and interaction reviews cover final layout, contextual help, selection/cancellation, product setup return, new-tab handoff, failures and full-name disclosure. Local simulation, native observation, deployment and owner acceptance remain separate: no theme Save, deployment, new permission grant or backend contract change was performed.

Final checks pass: 17 domain/navigation tests; both focused browser workflows; the existing Settings/theme-link editor regression; the 51-capture gallery workflow; strict admin-test TypeScript; scoped Biome; the 151-file Astro check/build; and official pinned Polaris JSX and Liquid app-context validation. One combined browser run exposed an assertion timing race: the published result renders before Preact's effect restores focus. The independent interaction reviewer changed the test to wait for the actual bounded focus outcome, retaining the assertion. No production focus defect was reproduced or production change made for that failure. The final combined browser rerun passes both workflows.

## Delivered scope

The application route `/admin/settings/storefront` now has two independent theme tasks and a separate customer test. Product configuration is needed for that test, not for installing either theme feature. Shopify owns block placement, embed activation, theme preview and Save. Insignia provides scoped activation information and editor links rather than copying the Shopify editor.

The customization task identifies the actual “Insignia customization” block. Cart review identifies the existing “Insignia cart repair” embed and describes saved Insignia designs, not arbitrary cart editing. The final test names the real “Review customized cart” trigger. No Liquid or storefront behavior changed.

The page uses the pinned Polaris 2.0 RC runtime/types. Native sections, headings, badges, banners and controls own the presentation; local CSS owns the responsive task rows. Other-theme/template/compatibility guidance is disclosed on demand. There is no forced wizard, routine Refresh control or unmeasured “Setup complete” claim.

## Status and navigation rules

- Read `shopify.app.extensions()` without additional scopes. Only the published theme is represented.
- Recognize the exact `customize`/`section` and `cart-repair`/`body` records. Validate placements before showing a positive state. Missing, malformed, contradictory or duplicate records remain unknown.
- Available items offer Shopify’s add/activation proposal links. Active or unknown items open the existing editor without `addAppBlockId` or `activateAppId`, avoiding an accidental duplicate.
- Cart editing opens the App embeds context. Product-block editing opens the product template.
- Automatically recheck after returning to the app. Deduplicate focus/visibility return events, bound a check to eight seconds, and disregard late/disposed requests. A click or return alone never changes activation status.
- A rejected or timed-out check has one contextual Retry. Retry stays mounted while pending; successful keyboard recovery focuses the named theme section. Missing API support is neutral and retains manual editor access.
- Validate the Shopify hostname and public API key before building editor links. Outside Shopify, show the manual route rather than unusable theme buttons.

The status read cannot prove every template is covered, placement is useful, an unpublished theme is ready, or the customer journey works. The product test stays visible even when both features are active.

## Research and independent passes

The [research record](storefront-setup-research-2026-10-26.md) establishes the Shopify ownership boundary and setup order. Primary sources include:

- [Theme extension UX](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/ux): native editor handoffs and installation guidance.
- [Theme extension configuration](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration): editor proposals and manual setup.
- [App API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api): published-theme scope, exact response shape and active/available/unavailable semantics. App Bridge is not versioned with Polaris.
- [Shopify setup guide composition](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/setup-guide) and [Settings pattern](https://shopify.dev/docs/api/app-home/v2.0/patterns/templates/settings): task grouping and native section/action hierarchy. The actual implementation remains on the repository’s RC runtime.

The official Shopify app-block onboarding illustration was visually inspected before composing the page. The installed Checklist Design Settings, Onboarding and Banner checklists, fresh Vercel interface guidance, and the established Memorisely/Zander hierarchy guidance supplement Shopify. Their application and limits are recorded in the independent design review.

A Luna Max [failure audit](storefront-setup-failure-audit-2026-10-26.md) extracted predictable owner-feedback failures from actual review records and checked cart behavior against source. Separate GPT-6.1 Sol medium [design](storefront-setup-design-review-2026-10-26.md) and [interaction](storefront-setup-interaction-review-2026-10-26.md) reviewers inspected the rendered revision. No blocking findings remain in their local scope.

The design reviewer caught phone overflow in unknown/outside banners. Polaris hosts use `display: contents`, so host minimum-width changes alone did not constrain shadow-rendered grid items. An explicit `minmax(0, 1fr)` composition track fixed the intrinsic expansion. All states were recaptured after that correction. The interaction reviewer prompted the retained Retry/focus recovery fix and independently checked the final behavior.

## Verification

Passed:

- Two domain/navigation tests: exact handles/targets/placements, ambiguous and invalid records, and safe deep links.
- One focused browser workflow: active/available/unknown/missing API/failure/outside states, automatic return, pending status, deduplicated reads, Retry focus and phone action alignment.
- Updated existing editor regression: exact unsaved theme proposal links, one Settings breadcrumb and no Admin theme API calls.
- Focused gallery workflow: all nine base states plus expanded guidance at 1440, 390 and 320px; visible text edges, no horizontal overflow, safe local handoff, unchanged status after return, and actual HTTP 200 PNG delivery for every capture.
- Strict admin-test TypeScript, scoped Biome, the 148-file Astro check/web build and official Polaris 2.0 RC JSX validation.
- Independent Sol rendered checks: 27 design state/width combinations and 21 interaction combinations, plus expanded/long-copy and keyboard/pointer checks. Reviewers observed no mutating HTTP requests.

A final delivery check caught an omitted preview image-folder allowlist entry. It was corrected, then the focused gallery and independent verifier confirmed all ten hosted desktop/phone pairs return valid PNGs. The review gallery opens on the ten new Storefront setup states. It now contains 133 states and 265 desktop/phone captures; ten additional narrow proof captures are retained under `storefront/narrow`. Phone captures preserve their width and include the complete nested document rather than cutting off lower content.

## Evidence and limits

Application island, status parser and responsive composition are implemented locally. Synthetic App Bridge scenarios and a clearly labeled editor handoff exist only in the loopback preview. They never write a merchant theme or pretend that returning saved a change. Existing app/theme versions were not published, scopes were not granted, and no backend contract changed.

Native embedded Shopify activation, theme Save, end-to-end customer testing against a real store, deployment, owner visual acceptance and release approval were not performed. Those are not implied by the local passing results.


## Predictive owner-feedback pass

The owner asked for an additional pass based on likely feedback rather than waiting for another annotated review. Root and the independent Sol design reviewer identified the same four concrete weaknesses in the rendered V1:

- Installation commands remained beside Added/Enabled badges. Task descriptions now explain the customer purpose in every state; the existing Edit actions remain unchanged.
- The normal cart row mixed purpose, an internal-sounding schema name and navigation instructions. Exact current Shopify names and manual setup steps now live under Theme setup help, where they are useful. The extension display names/handles and behavior were not changed.
- The customer test was a phone paragraph. It now uses the supported native Ordered list for the actual three-step test; Choose a product still describes its real Products destination.
- Failed checks used Not checked, indistinguishable from absent status evidence. Failed rows now say Couldn’t check; unknown and unsupported cases say Not verified. The neutral banner has a heading and points to the unverified items. Retry focus and automatic checks retain their existing behavior.

Repeated unavailable-state narration was also trimmed. The compact task layout was retained; no extra cards, illustrations, metrics, progress states or features were added.

The updated state-label browser regression failed before implementation and passed afterward. The three focused status/navigation/browser tests, 30-capture gallery including hosted PNG checks, strict admin-test types, scoped Biome, web check/build and Polaris 2.0 RC revision2 validation pass. A fresh independent Sol rendered review covered normal, active, failed and unknown states at desktop/390/320 plus expanded help at320; no blocking findings remain. The same ten gallery states were refreshed rather than adding duplicate versions. Local evidence still does not establish native Shopify Save or owner acceptance.
