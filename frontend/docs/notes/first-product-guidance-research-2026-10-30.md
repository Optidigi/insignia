# First product guidance review — 2026-10-30

## Recommendation

Do not add a first-run wizard, click-through tour, or example product. The existing Home setup checklist and product editor already point to the next concrete action at each stage. The inspected first-product path has no missing step that warrants another guidance layer. Keep guidance attached to the task and its current state.

This is a best-practice and product-flow review, not evidence that merchants prefer one approach: no user interviews or usability study were run.

## What exists today

| Surface | Observed behavior | Implication |
| --- | --- | --- |
| Home, `HomeGettingStarted.tsx` / `MerchantHome.tsx` | A three-step checklist covers adding a product, preparing the storefront, and testing. The product action changes with shop state: add a product when none exists; finish setup when a draft exists. | It gives a clear first action and keeps setup tasks visible without a separate tour. The checklist completion mark is manually acknowledged, so it should not be read as verified configuration state. |
| Production product editor, `MerchantConfigEditor.tsx` | Four named sections: Product rules → Images and print areas → Prices → Review and publish. It displays “Step n of 4”, Back/Continue, and “All settings.” Empty method-library state says so and links to the method setup route. | The next action remains in context. The method path depends on the merchant’s actual library; no example method or price is needed. |
| Local polished editor preview, `apps/web/test/admin/support/placement-workflow-preview.tsx` | The preview was interacted with using its local “First product · no methods” fixture. It is explicitly local-only and does not write a production draft, publish to Shopify, or sync Methods. | Useful for inspecting interaction/copy only; its fixture is not evidence about Shopify production state. Its synthetic “Printing” method at €5.00 must not become a default/example in onboarding. |

## First-product action sequence

The selected polished editor answers the “what next?” question with contextual actions. It is not the separate production editor's four-step wizard:

| State | Current prompt/action | Assessment |
| --- | --- | --- |
| No product view | “Add your first product view”; explains that a view is a product photo (such as front or back), then asks to mark where customers can add artwork. Primary action: “Add view.” | Concrete, contextual first action. |
| A view exists, no placement | “Add a placement, then resize and position its artwork area on the image.” Action: “Add placement.” | Clear next step; no tour needed. |
| Placement exists, artwork area not drawn | “Draw area”; helper says it sets the maximum artwork size and starting position. | Explains the consequence next to the control. |
| Placement has no method | “Choose methods”; explicit empty state says no decoration methods are selected and directs the merchant to choose from their library. | Correctly defers to the merchant’s real methods instead of guessing. |
| Method needs product-specific setup | The local preview’s product-only method form says: “Only added to this product. Set its placement prices next.” | Directly identifies the next task. The available price fields depend on the actual method. |
| Price is missing | Placement method/size settings expose the price controls. Local publication validation identifies missing method/size prices and opens the relevant placement. | The existing editor directs the merchant to the actual missing value. The separate production Prices step is not part of this selected UI. |
| Ready for review | The selected editor has Preview, Save draft and a direct Publish action with issue/recovery handling. | These are distinct actions. Local publication is a simulated snapshot, not Shopify publication; there is no selected “Review and publish” wizard step. |

No transition observed required a “Next” demo step. Guidance should stay attached to the relevant empty state or field if a future usability report shows a specific point of confusion.

## Checklist Design audit

Reviewed the [Web App Onboarding checklist](https://www.checklist.design/web-app/onboarding) item by item against Home and first-product setup. Status describes this product flow, not a general recommendation for every app.

| Checklist item | Status | Evidence / decision |
| --- | --- | --- |
| Progress indicator | Present on Home; not needed as a second linear guide in this editor | Home’s three-step setup guide shows progress. The selected editor is a non-linear canvas with contextual task prompts; “Step n of 4” belongs only to the separate production editor. |
| Welcome message | Not needed | The first-product view prompt names the current task and the immediate action. A generic welcome would add a heading without helping the task. |
| Account setup | Not applicable here | This review begins inside the merchant product editor, after entry to the app. Account connection/setup is outside this first-product flow. |
| Product highlights | Present in context | The editor explains views, placements, artwork area, methods, and prices beside the related action. A separate visual tour would duplicate those cues. |
| First action prompt | Present | Home and the editor each offer a state-dependent first action, including “Add view” for the inspected empty editor state. |
| Completion confirmation | Partial | The selected editor distinguishes saved draft and simulated publication feedback. Home progress can be manually acknowledged, so it should not be presented as automatic verification of product, theme or test completion. |

Checklist Design’s product-highlights item describes contextual tips or a visual walkthrough with a skip option. Here the inline, state-specific prompts already cover the relevant actions; the checklist is an audit aid, not a mandate to add a walkthrough.

## Source basis

- Shopify’s [App Home setup guide pattern](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/setup-guide) supports an essential-task setup guide with progress and completion. Shopify’s [app onboarding guidance](https://shopify.dev/docs/apps/design/user-experience/app-home-page) says onboarding should get users to basics quickly, should be deferrable when complex, and should avoid long checklists. These patterns support using the existing short checklist; they do not establish user preference for this particular flow.
- Shopify’s [content guidance](https://shopify.dev/docs/apps/design/content) favors clear, concise, action-oriented content and avoiding duplication. This supports keeping the existing next-action prompts instead of repeating them in a tour.
- Vercel’s [empty-state guidance](https://vercel.com/geist/empty-state) distinguishes blank-slate, informational, educational, and starter-content states, and recommends making tours optional. This is secondary guidance; it does not justify inventing sample merchant data.
- Vercel’s [interface guidelines](https://vercel.com/design/guidelines) recommend inline help and designed states. Memorisely’s [visual hierarchy post](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) and Zander Whitehurst’s [progressive-disclosure post](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) were treated only as secondary design heuristics, not usability evidence.

## Local screenshots

These are screenshots of the local test preview fixture, not production UI or Shopify screens. The preview used local-only draft state; no production draft, Shopify product, method library, or price was written.

- Empty first-product state: [`first-product-empty.png`](/Users/pc/Development/Insignia/.artifacts/first-product-guidance-research-2026-10-30/first-product-empty.png)
- After adding a view: [`after-first-view.png`](/Users/pc/Development/Insignia/.artifacts/first-product-guidance-research-2026-10-30/after-first-view.png)
- After adding a placement: [`after-first-placement.png`](/Users/pc/Development/Insignia/.artifacts/first-product-guidance-research-2026-10-30/after-first-placement.png)

## Scope and decision

No application change is warranted for first-time guidance based on this audit. No production or native Shopify writes were made, and no tests were run as part of this research.
