# Storefront setup design review

Independent product/design review on 26 October 2026. Reviewed `StorefrontSetup.tsx`, `storefront-setup.ts`, `storefront-setup.css`, the Settings entry, repository admin guidance and the storefront setup research. Applied the bundled Checklist Design skill, Shopify's official App Home guidance and current supplementary Vercel guidelines. No application edits, builds, account actions or Shopify theme changes were performed by this reviewer.

## Verdict and evidence

No remaining product/design blocker in the final local composition. This is an internal review of the actual Polaris RC rendering in the loopback preview iframe. It does not establish native embedded Shopify acceptance, a real theme installation or a completed customer journey.

The page now has one published-theme context, two independent theme task rows and a final customer test. Product configuration no longer looks like a prerequisite for opening the theme editor. Each row has one relevant action. Shopify owns saving and placement. The green statuses describe measured theme activation, while the customer test stays visible and unmeasured. The product action says `Choose a product`, which matches its Products destination.

The first source pass flagged the old product-first numbering, duplicate editor actions, the unsupported claim that the product button only appears for published configurations, missing status scope and cart repair jargon. The final revision resolves these. It uses the exact editor labels only where they help the merchant find the relevant controls.

Final independent browser pass used `http://127.0.0.1:62168/admin/settings/storefront` with synthetic preview examples. At each of 1280, 390 and 320 CSS pixels, inspected initial, active, button-added, cart-enabled, unknown, unsupported, error, unavailable and outside states. Every document's measured `scrollWidth` equalled `innerWidth`. Visually inspected final desktop, active phone, unknown phone, failure phone and outside phone captures. Expanded the other-theme guidance at 320 and scrolled to confirm the final product test and action remain reachable and readable.

Task actions stack below their copy on phones. Text and status labels wrap without clipping. The collapsed initial and active views remain compact. Error and expanded guidance states legitimately need vertical scrolling. There is no decorative hero, invented metric, app-level Save control or routine refresh action.

### Defect found and fixed during review

The first rendered unknown and outside states overflowed at 390 pixels, expanding the app document to 552 and 840 pixels respectively. Their banners caused the whole page to clip horizontally. Wrapping banner copy in paragraphs and adding minimum sizes to custom-element hosts was insufficient.

The implementation review found that Polaris banner and section hosts use `display: contents`, so their rendered shadow content participates in the surrounding CSS grid. Its implicit `auto` track retained the content's intrinsic width. The final `.storefront-setup` uses an explicit `grid-template-columns: minmax(0, 1fr)`. Final browser measurements and screenshots confirm that the unknown, unsupported and outside states now fit at all three widths. This is why reviewing only the initial state would have missed a real defect.

Working screenshots from this review are under `/tmp/storefront-final-*.png`. They are local review evidence, not permanent delivery artifacts. The root agent owns the separate gallery capture and automated interaction results.

## Shopify source checks

Shopify's [theme extension UX guidance](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/ux) assigns block placement, embed activation, preview and saving to the theme editor. The final page respects that ownership and offers separate instructions for blocks and embeds. Its other-theme disclosure explains template coverage and a manual compatibility route.

The [configuration documentation](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration) documents deep links as editor proposals before saving and `app.extensions()` detection without extra scopes. The page offers theme links, requires no new permission flow and makes no direct theme writes.

The [App API reference](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api) limits theme activation evidence to the published theme. `unavailable` means disabled, potentially even while placed. The final UI keeps unknown separate from inactive, labels unavailable neutrally and retains the editor route. Activation does not prove every product template, good placement, product readiness or customer flow. The visible final test and published-theme heading preserve those limits.

Shopify's [content guidance](https://shopify.dev/docs/apps/design/content) supports the short task headings, direct action labels and exact editor names used here. The [versioned setup-guide composition](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/setup-guide) supports a task list but does not require the example's counters or illustrations.

## Checklist Design audit

Read the actual local v3.2.4 checklist files. The bundle contains Settings and Onboarding. It has no standalone Success or Error checklist. The real Banner checklist covers state messages; Showing input error was inspected and is inapplicable to this page's lack of editable fields. Those distinctions avoid attributing invented rules to Checklist Design.

Markers: present, partial, not needed and cannot tell. No numeric score is assigned. Descriptions below retain the checklist's item wording.

### Settings

[Settings checklist](https://www.checklist.design/web-app/settings)

| Status | Item | Why |
| --- | --- | --- |
| Present | Structure. Organising settings controls into logical categories e.g. account, notifications, security, billing. | Storefront setup has a dedicated Settings destination and groups the two theme tasks separately from the product test. |
| Not needed | Account details. The fields where users update their name, email address, and profile photo | This page configures storefront integration; Shopify owns account identity. |
| Not needed | Security details. The ability to change the password, two-factor authentication and other security information | No credentials or security settings belong in this task. |
| Not needed | Notification preferences. Controls for which notifications the user receives and through which channel, grouped by type (product updates, reminders, billing) | Storefront installation has no notification choice. |
| Not needed | Billing. Managing payment method, upgrading or cancelling a payment, this could also be a preview of this information with a link directly to the billing page if separate | Billing has its own Settings destination and has no dependency on theme installation. |
| Not needed | Additional preferences (if applicable). Language, timezone, date format, and appearance settings like dark mode | No such preference is required for these theme tasks; Polaris owns appearance. |
| Not needed | Danger zone. Destructive actions like account deletion, clearly separated from the rest of settings | The page has no destructive action. |

### Onboarding

[Onboarding checklist](https://www.checklist.design/web-app/onboarding)

| Status | Item | Why |
| --- | --- | --- |
| Present | Progress indicator. An indication of how many steps are involved and where the user currently is in the sequence | Two independently labelled activation statuses show current measured progress without inventing a serial wizard or customer-test completion. |
| Present | Welcome message. A brief message acknowledging this is a new experience and orienting the user toward what the product does. | The title, published-theme context and short editor instruction orient the task without adding ceremonial welcome copy. |
| Not needed | Account setup. The minimum information needed to personalise the experience, gathered at the start | The authenticated Shopify context already supplies the store. |
| Present | Product highlights. Key features introduced through short contextual tips or a visual walkthrough | Each row explains its customer purpose beside its action; detailed theme guidance stays optional. |
| Present | First action prompt. A clear prompt directing the user to an action or feature | Add to theme and Enable in Shopify are available independently of product configuration. |
| Partial | Completion confirmation. A clear acknowledgement that setup is complete, transitioning the user into the main product | Added and Enabled confirm only activation. Whole setup completion remains deliberately unclaimed because the customer test is manual. |

### Banner

[Banner checklist](https://www.checklist.design/design-system/banner)

| Status | Item | Why |
| --- | --- | --- |
| Present | Style. How the banner types look (fill, text colour, border radius etc) | Actual Polaris info and warning banners render distinctly and fit all reviewed widths after the grid fix. |
| Partial | Content. A title is a must but you can consider a description if you feel a title does not convey enough information | Failure and outside banners have titles. The unknown info banner uses one short self-contained instruction without a separate title; usable, minor generic-checklist deviation. |
| Present | Types. Banners typically appear as 5 options: information, success, warning, error, neutral. This helps visually establish context and level of importance. | Unknown/outside use info and a failed check uses warning; row success badges avoid a false whole-page success message. |
| Present | Call to action button. A banner may call for the user to do something, like fix the error it is calling out, or viewing the successful outcome of an event. | Failure alone offers Retry; editor actions remain in the affected task rows. |
| Present | Placement. Where the banner sits on the page, dependent on context and importance | Status-check problems appear above the published-theme tasks they affect. |
| Not needed | Dismissable. Whether the banner can be dismissed. Positive/neutral banners (info and success) would suit this, but not warning/error banners as they are too critical. | These persistent context/recovery messages describe the current state; removing them could hide why verification is unavailable. |

### Showing input error

[Showing input error checklist](https://www.checklist.design/flows/showing-input-error)

| Status | Item | Why |
| --- | --- | --- |
| Not needed | Keep the input in default state. The text field should be checked for errors only after the information has been entered. | No editable input exists on this page. |
| Not needed | Allow user to enter information. Let the user type without interruptions and submit the information aka don't assess as changes are made. | No editable input exists on this page. |
| Not needed | Signal error after loss of focus. After the input has lost focus (user has clicked another element), the field should be assessed. Looks like we have an error here! In this case, explain why the error happened, and what is required to resolve it. For accessibility, combine the text with a visual icon that indicates an error was found. | Theme status is an asynchronous read, not field validation. The failure banner supplies explanation, recovery and an icon instead. |
| Not needed | Return to default state upon reattempt. Once the user focuses on the field again, the error message should disappear. If there is an error again, the process will simply repeat until they are able to continue. | No editable input exists. Retry loading and focus recovery belong to the separate interaction verification. |

## Supplementary interaction limits

Fetched the [current Vercel guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Applied relevant checks for real navigation links, text wrapping, visible recovery, focus and asynchronous announcements. Shopify's sentence case, Polaris contracts and repository silent-loading policy take precedence over conflicting generic typography and loading-copy examples.

Source includes an accessible status announcement, real links and a named programmatic focus destination after successful retry. The final rendered pass establishes wrapping and reachability. This reviewer did not independently exercise every keyboard, timeout, retry or editor-return path and does not substitute screenshots for those behavioral checks. Root's focused browser suite owns that evidence. No native Shopify appearance or real customer journey was exercised here.

## Follow-up after predicting owner feedback, 26 October 2026

The owner asked us to anticipate their next feedback and act on it. Re-read the historical gallery and Settings feedback, then challenged the earlier approval against the actual rendered screen. That approval correctly covered the bounded design and overflow checks, but accepted avoidable copy density and repetition too readily. Historical owner comments repeatedly preferred removing redundant explanations, keeping manual details contextual and making the primary task easier to scan.

Four concrete objections were raised before implementation:

1. The active state still instructed the merchant to place and enable items next to green Added and Enabled badges.
2. The customer test was a dense paragraph on phones, despite containing a real sequence of actions.
3. The normal cart row mixed customer purpose with exact extension names and App embeds navigation already handled by its deep link.
4. A failed check displayed Not checked, which incorrectly suggested no attempt had happened.

The revised page addresses these without changing the two-task layout or adding new UI. Row descriptions now explain purpose. Exact block/embed names, placement and manual instructions live under Theme setup help. The final customer test uses a supported three-item ordered list. Failed reads say Couldn't check, while unknown or unsupported status says Not verified. Added and Enabled remain specific to known activation. The unknown info banner now has a heading and a short action-oriented explanation, resolving the earlier Banner Content deviation.

Independently reopened the rebuilt loopback page and captured normal, active, error and unknown states at 1280, 390 and 320 pixels. Visually inspected all 12 captures. Every document's scroll width matched its viewport. Expanded Theme setup help at 320 pixels and scrolled to confirm that the manual guidance, ordered customer test and Choose a product action remain readable and reachable.

The shorter task descriptions improve hierarchy on both desktop and phones. The ordered customer test makes its sequence visible without pretending it is automatically verified. At 320 pixels the failure badge wraps below the longer task heading; it remains legible and does not justify tighter spacing or smaller type. Help is longer when expanded because it contains the actual manual route and published-theme limitations; keeping that detail optional is appropriate.

No remaining concrete copy, semantic or spacing blocker in this revision. This follow-up supersedes the earlier observations about dense test copy, repeated installation instructions and the missing unknown-banner heading. The original review remains intact as the record of the first pass. Native Shopify acceptance, actual merchant usability and a real customer journey remain outside this local review.

## Visual composition and product-test follow-up, 26 October 2026

The owner subsequently authorized actual composition polish and a comparison with logged-in Shopify screens. This supersedes the earlier text-only composition assessment. The root agent performed the native read-only inspection, reporting Products detail and Home media-card references, including the product-specific theme-preview route. The theme editor rendered blank during that inspection. This independent reviewer did not inspect those logged-in screens and does not claim a native theme-editor comparison.

Re-read the owner's historical gallery feedback. Their first-view direction asked for relevant product imagery grouped with a heading, explanation and direct action; they also repeatedly removed duplicate instructions and permanent refresh controls. The [official media-card composition](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/media-card) supports pairing visual context with actionable text in Settings. [Shopify layout guidance](https://shopify.dev/docs/apps/design/layout) supports consistent density, the 4px spacing rhythm and one principal action per card. The bundled Checklist Design Spacing / Grid, Typography and Empty State material informed spacing and contextual imagery. This is a use of relevant principles, not an assertion that storefront setup is an empty-state screen.

### Actual critique and resulting composition

The first media revision was not visually ready. Its thin gray wireframe garment, placeholder bars, browser chrome and tiny trigger text made the two outcomes nearly indistinguishable. At 390 pixels, two illustrated blocks plus captions and three help toggles pushed the customer test entirely below a 900px viewport. The review requested meaningful visual outcomes, readable trigger labels and less help chrome, rather than approval based on the mere presence of SVG components.

The final illustrations are useful outcome vignettes. A filled navy garment and a visible contrasting design distinguish product entry from reviewing a saved cart design. Their real customer-action labels remain readable at the rendered 200×110 size. Decorative browser chrome and external captions are removed. These are clearly illustrations, with accessible example descriptions, rather than store-specific screenshots or live controls.

Each task now keeps its illustration, heading, status, short purpose and action together. Actions sit under their descriptions instead of being detached at the far edge. Two named native info buttons provide contextual manual instructions in popovers; one shared disclosure retains unpublished-theme and compatibility limits. The popovers fit at 390 and 320 pixels, remain readable after their opening animation and dismiss with Escape. Both info buttons have distinct accessible names. The Liquid display name now says Insignia cart review, matching the merchant feature while preserving its existing handle.

The phone layout costs vertical space compared with the text-only version, but that space now explains two different customer outcomes. Removing the wireframe captions and long help-toggle rows materially reduces the earlier media revision's height. In the final 390px initial view, the customer-test heading appears around 794px. The page retains one coherent setup context rather than becoming a set of promotional cards. This is an acceptable tradeoff for the owner's requested visual context.

### Product-test workflow and evidence integrity

The final customer test selects a product through Shopify's Resource Picker contract, checks its actual published customization state and offers a product-specific theme-editor preview. Its initial state remains one short prompt and a Choose a product action. The selected state distinguishes a published configuration, an unpublished configuration and an unsuccessful read. Preview in theme editor states its destination directly without a repeated helper sentence. The real customer test remains manual; a successful configuration read does not mark the customer journey complete.

Used the isolated loopback picker to select a product in published, unpublished, failed-read and long-title examples. An independent pass caught a fixture regression after synthetic product IDs were replaced with actual local-catalog IDs. The browser interceptor still matched the old IDs, so the advertised ready/error/long-title examples all rendered unpublished. Reported the exact stale matcher. Root corrected it and added expected-state assertions to the capture workflow. The affected states were not accepted from misleading screenshot filenames.

After the corrected server restart, independently verified the actual state attribute for all four examples: published, unpublished, error and published respectively. Captured and measured each at 1280, 390 and 320 pixels. Every document's scroll width matched its viewport. The unpublished action was also exercised against the local catalog and reached the existing product configuration workspace. This confirms the local recovery destination, not native Shopify or production integration.

The long-title stress case preserves the entire selected name and remains readable without horizontal overflow. At 320 pixels it occupies about 11 lines before the actions. That is a minor compactness tradeoff worth retaining in the evidence, not a hidden pass or a blocker. A future bounded-name treatment should reuse the application's full-name access pattern, not discard access to the name.

Final verdict: no blocking product, copy, layout or local navigation finding remains in this revision. The vignettes now add useful context, contextual help no longer dominates the task actions, and the selected-product flow provides a concrete next step. This reviewer performed no application edits, builds, account actions or store/theme writes. Root owns component validation, focused automated tests and the permanent gallery. Native Shopify activation and Save, a real customer test, owner visual acceptance and deployment remain separate.

Final long-name resolution, 26 October 2026: the implementation now uses the shared overflow detection with a three-line title cap and a native View full name popover only when clipping occurs. Independently verified 390px and 320px long-title renders. Both title containers measure 60px at a 20px line height; the complete original title remains in the accessible text and appears legibly in the popover. Preview and change-product actions remain reachable. Escape closes the popover. A normal selected product at 320px has no reveal action. This resolves the long-title compactness tradeoff recorded above without changing the approved figures or product-test flow.

## Owner-rejected media correction and current Shopify review, 26 October 2026

This assessment supersedes the approval of synthetic outcome illustrations and icon-only setup help above. The owner rejected those additions. Re-examining the actual gallery captures against Shopify's primary guidance showed that the media recommendation was wrong for this page. A supported media-card pattern did not establish that the invented miniatures helped a merchant complete theme setup.

The dark fake customer buttons were visually stronger than the real setup actions. The illustrations did not explain adding a block, choosing its location or activating an embed. On phones they added two large blocks before the task headings and pushed useful work downward. Meanwhile the real instructions had been hidden behind info glyphs. This was a task hierarchy regression, despite passing component and overflow checks.

Fresh source review used the official Shopify skill's iframe App Home reference and current primary documentation. [Theme extension UX](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/ux) calls for clear post-installation instructions that distinguish app blocks from embeds and explain the editor workflow. [Shopify content guidance](https://shopify.dev/docs/apps/design/content) favors direct actions, short scannable instructions and avoiding duplicated content. [Layout guidance](https://shopify.dev/docs/apps/design/layout) supports coherent density and clear grouping. The [setup-guide composition](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/setup-guide) illustrates onboarding tasks; its sample illustrations do not prescribe decorative media in every setup page. No current source requires these SVGs.

The corrected rendered page removes the SVGs and info popovers. Two compact rows show the actual block/embed instructions inline when setup is available, with a shared reminder that Shopify owns Save. Unknown status tells the merchant to check the existing setup, avoiding an unverified Add instruction. Known active rows retain short purpose text and an edit action. One optional disclosure explains product-template coverage, unpublished themes and compatibility. The selected-product customer test and its real recovery paths remain intact.

Independently captured and inspected the rebuilt loopback page at 1280, 390 and 320 pixels in not-added, active and unknown states, plus expanded theme guidance at 320. All nine measured documents have scroll width equal to viewport width. No illustrative media remains. Desktop actions align at the trailing edge of their rows; phone actions sit below their instructions. In the 320px initial state, both theme tasks and the customer-test entry fit within approximately 725px of page height. The actual controls now own the visual hierarchy, and necessary instructions are visible without opening help.

Current Shopify-lens verdict: no blocking composition or instructional-copy finding in the corrected page. The primary source boundary remains important: this is an independently observed local iframe rendering using the selected Polaris RC. It does not establish native Shopify activation, theme Save, all-template coverage, a completed customer journey or owner acceptance. The prior media approval remains historical and is explicitly withdrawn by this section.
