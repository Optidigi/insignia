# Home first-use composition review

26 October 2026. Independent follow-up after the owner rejected the no-products Home as too deserted. This feedback supersedes the previous review's approval of a sparse initial guide. No application edits were made in this review.

## Evidence

Re-opened the saved native `search-discovery-initial.png`, `flow-first-use.png` and `translate-adapt-resource-hub.png` under `/Users/pc/Development/Insignia/.artifacts/home-research-2026-10-26/`, plus Insignia's current desktop `home-no-products.png`. Read the native observation, state-priority and Shopify pattern research notes, current Home render conditions and method-library creation route. Used the bundled Checklist Design Dashboard, Onboarding and Empty State lenses.

Freshly read Shopify's [Homepage template](https://shopify.dev/docs/api/app-home/latest/patterns/templates/homepage) and [Setup guide](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/setup-guide). The requested versioned URLs redirect to current v2.0 documentation; this is current public pattern guidance, not a preserved release-candidate snapshot. No new component code was generated here.

## Guide placement

The native Search & Discovery capture clearly places its expanded Get started guide before both its search and recommendation metrics. Its no-data analytics remain below. The official Homepage example likewise places its guide before metrics. These are direct evidence for guide-first onboarding; neither proves a universal order for established shops or urgent work.

Recommend state-dependent ordering:

1. Access failures or actionable production work lead where present.
2. An incomplete, relevant guide precedes performance metrics. Keep the operating guide collapsed by default so educational content does not obscure current work.
3. Once the guide is completed or dismissed, metrics and operational activity lead. The compact completed guide or restore action can follow.

A manually unchecked guide does not prove a shop is new. Product and order evidence should select its active step and default expansion. Pending artwork remains above education regardless of the completion count.

## Why no-products feels deserted

The current desktop capture has one roughly 300 px setup card, then around 650 px of blank page. Its active step says to create a Shopify product but does not explain the customization-to-order workflow. The other steps are collapsed. A single next action is clear, but the page gives a new merchant little understanding of the workspace they are entering.

Flow's initial screen provides a large creation prompt and substantial real templates/news. Translate & Adapt offers a resource hub with quick-start context. Search & Discovery combines setup and real report sections. The shared lesson is useful context and destinations beyond the first button. Their particular news, templates, broad resource categories or zero charts do not automatically fit Insignia.

## Recommended first-use content

Keep the expanded guide as the top task. Add one short orientation that explains what the app connects: product customization, the customer's design, and merchant order work. A relevant official illustration inside its active product step can provide context, but increasing illustration size alone will not fix missing content.

Below the guide, add one substantive `How customized orders work` section. Explain three real stages concisely: configure artwork areas, decoration options and pricing; the customer creates a design and checks out; the merchant reviews the customized order and downloads artwork. This teaches the connection between product setup and later order work. It needs no second `Add product` button and no pretend sample order or invented customer screenshot.

A compact optional `Decoration methods` resource row may offer useful preparation through `/admin/methods`. The method library exposes `Add method` independently of product creation. Keep this a secondary destination rather than a competing primary task. Do not repeat the theme or test actions already inside the guide.

After a product exists, show the legitimate no-orders context even while manual setup remains incomplete. The current `initialGuide && guideIncomplete` suppression removes that section through several pre-order stages. A concise empty orders panel explains where customized orders will appear without claiming the storefront is ready or implying the merchant must place a paid test order.

If the guide is dismissed or collapsed, preserve a clear required next action elsewhere. The educational workflow can remain useful, but it must not be the only content left while product creation is hidden. Permission-restricted and failed reads must retain their actual recovery/access state rather than resembling a fresh merchant.

## Review constraints

Do not fill the canvas with fake performance, sample resources styled as store records, empty chart grids, unsupported feature claims or generic news. Avoid duplicating Add product, Connect theme or Test instructions as both guide buttons and additional callouts. Keep decoration, garment sizes and artwork placement distinct. Manual guide completion does not establish publication, theme correctness or checkout readiness.

The target is a useful initial workspace with explanatory substance, not merely a taller card. The next implementation still requires desktop and phone pixels, especially after dismissal, no-products, existing unconfigured products, a draft, a published product awaiting theme setup, test invitation and a quiet established shop.

## Candidate pixel review

Inspected the new no-products desktop, 390 px and 320 px captures; desktop first-use, published-setup-pending, quiet-no-orders, operating and guidance-complete; and 390 px test-invitation. The welcome, guide and `From design to production` section make the initial page substantially fuller. The new content explains a real customer-to-merchant journey rather than adding decorative empty statistics or duplicate CTAs. It remains readable at 320 px, with one visible primary Add product action. Published/theme/test stages gain downstream context without copying their active guide task. Guide-first operating and metrics-first completed ordering match the state-dependent recommendation.

Reported one source-level omission before accepting the candidate: `hideInitialProductPanel` hides actual product work whenever the guide is visible, including when the merchant manually marks all three steps complete with no product present. Completion then collapses the guide and hides the Add product action despite the actual prerequisite remaining. Manual guide completion must not suppress factual missing-product work. Also reported minor phone polish: journey icon backgrounds stretch to the full text-row height; top-aligning them will keep them compact.

Completion focus needs the current gallery assertion rerun now that the keyed guide moves across metrics. The existing assertion focuses the collapsed guide control after the final checkbox. The keyed shared component is a reasonable preservation mechanism, but source alone does not establish browser focus continuity.

## Final disposition after correction

Re-opened the final 390 px and 320 px no-products captures. The journey icons are now compact squares aligned with their headings, while the copy wraps cleanly. Re-read the product-panel condition: it now requires both a visible guide and incomplete manual guidance before hiding the duplicate product panel. Completing the manual guide can therefore reveal the real missing-product action. The implementation agent added a browser regression covering no-products dismissal/restoration and all-three-complete action persistence, alongside the completion-focus and guide-order checks.

The corrected local composition is ready for owner review. It addresses the deserted initial Home with useful orientation and workflow context, retains one clear first action, and uses guide ordering grounded in the inspected Shopify reference. I found no remaining material presentation or source-state issue in the inspected scope. Independent interaction execution was not repeated by this reviewer; the implementation agent owns the current browser-test results. Owner acceptance and deployment remain separate.
