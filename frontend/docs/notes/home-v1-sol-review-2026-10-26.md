# Home V1 independent review

26 October 2026. Read-only review of Home presentation, its live adapter and explicit scenario fixtures. I used the installed Checklist Design audit, Shopify App Home guidance for the pinned Polaris 2.0 RC runtime, the project admin guidance, the Home research/preflight and freshly fetched Vercel Web Interface Guidelines. I inspected actual local PNGs at 1440, 390 and 320 px. No browser session or application state was changed by this review.

## Findings from the rendered pass

1. **Phone draft rows waste the space needed by their title.** In 390 px mixed-setup-orders and partialfail-orders, the thumbnail starts at x48 but the title starts at x170. At 320 px the ordinary product title is truncated after “Ontwerp je eigen” and even “Draft customization” wraps. The mobile grid's `auto` thumbnail track is wider than the image. Give the image its real fixed track and let the title use the remaining width. This is the main alignment correction.
2. **Plan restriction and the primary action disagree in the fixture.** The 320 px plan-restricted capture offers Configure product while saying new product configurations are unavailable. Set the scenario's actual `canConfigure` fact to false. Existing draft and order access should remain.
3. **Long-content includes internal test prose.** The 320 px description says “This local preview keeps the full task description available to check readable wrapping, line length, and spacing at narrow widths.” Replace that with believable merchant guidance. The gallery can explain its fixture outside the merchant page.
4. **The order empty graphic is a blank square.** Both desktop quiet-no-orders and mobile theme-unknown show the gray icon container without a glyph. Use a glyph actually rendered by the selected runtime or remove this optional graphic.
5. **Setup action labels promise more than their destination.** Fixture Add to theme and Enable in Shopify both open Insignia's Storefront setup page. The two unknown rows also repeat Check storefront to that same page. Use one concise Review storefront setup handoff, or accurately name the handoff if keeping separate rows. Settings owns the actual Shopify actions. This also avoids recreating Settings as a second setup checklist on Home.

These were specific appearance/content findings, not requests for new backend features. All five were corrected and verified in refreshed pixels. The final verification addendum records the evidence below.

## What works in the captures

The revised operating desktop view earns a separate Home through recent orders, a named draft and compact storefront guidance. The section titles and header actions share the content column; View all orders and View products are now visible. Orders use two desktop lines rather than the initial loose three-line composition. There is no greeting, decorative dashboard chart, invented total or all-clear claim.

At 320 px the first-use instructions and Configure product action remain readable, with no horizontal clipping. The merchant task keeps its order, actual reason and Review order action together. Order access restriction remains a local explanation, without fabricated empty orders. Partial order failure retains draft/setup content and offers local Retry and View orders. Awaiting artwork is neutral and distinct from historical Artwork unavailable; historic expiry does not become an urgent preparation task. Silent loading contains neutral shapes rather than text or a fake zero.

The collapsed storefront card is modest, though “Review your setup checks” adds little information. A single current task or precise status would be more useful than generic reassurance. The final explicitly acknowledged setup fixtures remove this card entirely, so a settled merchant no longer sees generic completed guidance.

## Dashboard checklist

Audited against [Dashboard, Web app](https://www.checklist.design/web-app/dashboard). Descriptions follow the installed checklist. Home is a compact work overview, so analytics and custom widgets are deliberate omissions.

| | Item | Why |
|---|---|---|
| 🟡 | **Welcome state** — A brief summary of what's happened since the last visit immediately re-orients returning users | Current named work orients the merchant; there is no source for changes since their last visit. A greeting would not fix that data limit. |
| ⚪ | **Key metrics** — The numbers most relevant to the user's goals, readable without leaving the home screen | No trusted analytics source is proposed for V1. Bounded rows are more useful than unsupported totals. |
| 🟢 | **Recent activity** — The most recently created or updated items, enabling users to resume work without hunting | Recent customized orders have dates and direct order links; drafts are named without claiming recency. |
| 🟡 | **Needs attention** — Time-sensitive items requiring a decision, surfaced here instead of buried in another view | The scenario has a reason-specific merchant task. The live list DTO does not supply precise recovery reasons, so production deliberately supplies no invented task queue. |
| 🟢 | **Quick actions** — Shortcuts to the most common tasks, accessible without navigating away. | Configure product and named draft actions exist; the corrected plan-restricted scenario removes the new-configuration action while preserving draft work. |
| 🟢 | **Empty state** — The state shown when there is nothing to show yet, with a clear first action | No Shopify products, unconfigured customization and no customized orders have distinct copy and appropriate next actions. |
| ⚪ | **Layout control (if applicable)** — Controls to show, hide, or reorder widgets so the home screen matches how the user works | A small single-column overview needs no widget editor. Optional setup can collapse. |

## Onboarding checklist

Audited against [Onboarding, Web app](https://www.checklist.design/web-app/onboarding). This Home is also for returning merchants and does not replace the separate walkthrough.

| | Item | Why |
|---|---|---|
| ⚪ | **Progress indicator** — An indication of how many steps are involved and where the user currently is in the sequence | Product and theme work are independent; V1 does not need a numbered wizard or percentage. |
| 🟢 | **Welcome message** — A brief message acknowledging this is a new experience and orienting the user toward what the product does. | Set up product customization and its one-sentence explanation orient a first-time merchant without a greeting. |
| ⚪ | **Account setup** — The minimum information needed to personalise the experience, gathered at the start | Shopify already supplies the authenticated merchant context. No account form is needed. |
| ⚪ | **Product highlights** — Key features introduced through short contextual tips or a visual walkthrough | Home links to actual product work. A feature tour would add steps. |
| 🟢 | **First action prompt** — A clear prompt directing the user to an action or feature | Product creation/configuration is clear; the corrected setup summary now uses an accurate single handoff. |
| ⚪ | **Completion confirmation** — A clear acknowledgement that setup is complete, transitioning the user into the main product | Theme activation does not prove the customer journey. Customer-test acknowledgment remains explicit evidence and no global readiness claim is made. |

## Empty-state checklist

Audited against [Empty State, Web app](https://www.checklist.design/web-app/empty-state).

| | Item | Why |
|---|---|---|
| 🟢 | **Illustration or icon** — A visual that signals the empty state and gives the screen some personality, rather than feeling broken | Product glyph renders. The corrected order empty state omits the optional graphic, removing the blank square. |
| 🟢 | **Clear heading** — A short, plain-language title naming what's missing | Add a product in Shopify and No customized orders yet describe different absences. |
| 🟢 | **Supporting description** — A brief explanation of what belongs in this space, most useful for first-time users | Copy explains product setup and that customized orders appear after checkout. |
| 🟢 | **Primary action** — A CTA pointing toward the next step: creating, importing, connecting etc | No-products uses native creation; first setup leads to product selection. Orders appear through real checkout, so there is no fake create-order action. |
| ⚪ | **Zero state vs. no-results state** — A distinction between a screen that is empty because nothing has been created versus one that returned no search or filter results | Home has no filters. Filtered no-results belongs to the existing resource pages. |
| 🟢 | **Error state variant** — A separate variant for when content failed to load, as opposed to genuinely being empty | Failed/restricted panels are separate states and retain successful content. |

## Loading checklist

Audited against [Loading, Design system](https://www.checklist.design/design-system/loading). Project guidance owns the silent skeleton convention.

| | Item | Why |
|---|---|---|
| 🟢 | **Visual indicator** — A clear representation that content is loading or in progress of change | Neutral skeleton shapes replace unresolved content. |
| 🟢 | **Text** — Explaining the loading state | Accessible status labels identify loading Home/products/orders; visible loading prose is deliberately omitted. |
| 🟢 | **Time** — Determine how long the time between two actions must be to require a loading component | Requests have bounded deadlines and failed reads gain recovery rather than an indefinite spinner. |
| 🟡 | **Accessibility** — Ensure your loading state can be clearly seen | Source exposes status/busy labels and shapes are visible in the light capture. Static PNGs cannot establish announcements or dark-host contrast. |
| ⚪ | **Visuals** — Entertain the user with an illustration during the loading state | Decorative entertainment is unnecessary for this short admin read. |

## Error/alert checklist

Audited against [Alert, Design system](https://www.checklist.design/design-system/alert). Input-validation guidance does not apply because Home has no form fields.

| | Item | Why |
|---|---|---|
| 🟢 | **Descriptive message** — Alert copy that explains what happened and what the user needs to do, rather than generic labels like 'Error' or 'Success' | Failed panel copy names the resource and offers recovery. |
| 🟢 | **Placement and stacking** — Where alerts appear in the layout, inline near relevant content, at the top of a form, or in a fixed notification area, and how multiple simultaneous alerts are ordered | Read failures stay inside their panel; an actual plan restriction is a single banner. |
| ⚪ | **Dismissible option** — A close button on alerts that are informational and don't require action, letting the user clear them when they're done | These are continuing resource failures/restrictions with a relevant next step, not disposable success messages. |
| 🟢 | **Icon reinforcement** — An icon alongside the message that reinforces the alert type, not as a substitute for colour but as a signal for colour-blind users | The plan banner has an icon, and local failures state the problem in text. |
| 🟢 | **Semantic variants** — Distinct visual treatments for informational, success, warning, and error states, using colour, iconography, or both | Restriction, failure, neutral waiting and success badges remain distinct. |
| 🟢 | **Inline action (if applicable)** — An optional link or button inside the alert for the most relevant next action, avoiding the need to navigate elsewhere to resolve it | Retry and the owning resource/Billing handoff are available beside the explanation. |

## Source review and boundaries

The review found and the parent corrected live product creation handoff, billing facts not reread after returning from Billing, out-of-order theme-result replacement, and unknown theme components being described as missing. Initial rendered missing header actions and loose order density were also corrected before this gallery pass.

Live data remains bounded. The first title-sorted product page cannot prove store-wide absence when another page exists. The adapter preserves unknown rather than restarting onboarding. The product summary prioritizes effective publication and does not expose newer saved edits on an already-published product; such products cannot currently appear as resumable Home drafts. Published evidence elsewhere in the catalog may also be outside the first page. These are recorded limits, not a reason to invent global facts or expand the backend during this frontend pass.

The test prompt is an invitation, not a counted incomplete customer test or a claim inferred from clicking. Fixture acknowledgment is explicit; production has no inferred acknowledgment. A recent-order list is not a complete attention queue. Live optional collapse has no persisted shop/user key, so this review does not claim a saved production collapse preference.

Evidence root: `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/home/`. Reviewed desktop operating, first-use, quiet-no-orders and expired-historic; mobile first-use, mixed-setup-orders, partialfail-orders, theme-unknown, awaiting-customer and restricted; narrow merchant-task, long-content, plan-restricted, loading-all, no-products and first-use. These captures establish local appearance only. Keyboard/focus results belong to the parent's executed interaction checks. Native Shopify host behavior, owner visual acceptance and release approval remain separate.

## Final verification addendum

I reopened the final narrow merchant-task, plan-restricted and long-content PNGs, mobile theme-unknown and desktop quiet-no-orders. All five findings are visibly resolved. The 320 px draft title now starts beside the 40 px thumbnail and its status fits one line. The restricted-plan header has no Configure product action. Long content describes real artwork review. No empty icon box remains, and unknown theme guidance has one accurate Check storefront action. Explicitly acknowledged setup is absent in the quiet and operating fixtures rather than repeatedly requesting a completed task.

I also inspected the new mobile create-product-pending and create-product-error captures. Pending uses the native busy button; error states name the failed handoff and preserve an actual Shopify products fallback. The initial error-state action/recovery cluster was left aligned within the centered empty state. I reopened the final 17:58 mobile error, pending and first-use captures and verified the action, error, fallback link and supporting description are now centered. This closes the final alignment reservation from actual pixels.

The parent reports that the real-container browser checks pass native product creation and rereading billing on return, and that retry recovery now focuses visible Product setup when empty orders are intentionally hidden. I did not independently operate those browser checks. All local visual findings from this review are resolved. I reopened the final mobile first-use capture and verified that its single row now says Connect your storefront, removing the repeated Storefront setup label and matching the live adapter. No unresolved material finding remains within the reviewed local UI scope. This is not native Shopify, owner or release approval.

## Final consistency source check

The final `homeOrderStatus` label is Artwork complete, matching the existing Orders `artworkStatusLabels.complete`. This avoids introducing a second merchant term and still scopes completion to artwork rather than overall production readiness. The internal state key does not change that visible meaning.

When a bounded catalog read is unknown or configured and has no identified draft, Home now omits the generic Product setup navigation card. The header retains the permitted Configure product action; first-use prompts still require established absence. This follows the research's preference for useful cross-resource work over duplicate navigation cards and does not treat unknown as empty.

The local Shopify products fallback is explicitly intercepted as a preview handoff and its gallery test checks the accurate Open Products in Shopify heading. This proves the local destination, not an actual Shopify action. These narrow source consistency changes add no backend capability or wider acceptance claim; the parent owns the final build/capture checks.
