# Home native correction review

26 October 2026. Independent reference and pixel review of the correction after the owner rejected the prior refinement. This review does not treat successful interaction checks or valid component tags as visual acceptance.

## Evidence inspected

- Actual native Search & Discovery capture, `/Users/pc/Development/Insignia/.artifacts/home-research-2026-10-26/search-discovery-initial.png`.
- Actual native Forms capture, `/Users/pc/Development/Insignia/.artifacts/home-research-2026-10-26/forms-inactive-overview.png`.
- Actual native Superfunny Orders metric strip, `/Users/pc/Development/Insignia/.artifacts/home-research-2026-10-26/superfunny-orders-metrics.png`. The main agent captured only the metrics, without private customer rows. I inspected that clip directly.
- Fresh official Shopify Dev MCP results for the [v2 setup guide composition](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/setup-guide), [metrics composition](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/metrics-card) and [homepage template](https://shopify.dev/docs/api/app-home/v2.0/patterns/templates/homepage). The selected source runtime is `polaris-2.0-rc.js`, with `@shopify/polaris-types` `2.0.0-rc.3`.
- Bundled Checklist Design dashboard and onboarding checklists. Their relevant checks are meaningful time context, recent activity, visible current work, progress, first action, a skip route and completion confirmation.

The native images are direct observations. The public examples document supported composition and behavior. Recommendations below are the reviewer's application of those sources to Insignia.

## Concrete composition findings

Search & Discovery has a narrow centered content column, with a white setup card and compact performance groups below. The setup card has a progress line, heading and brief purpose. Its expanded task is a subdued inset with an incomplete ring at the left, task title and short detail, a primary task action and a teaching image at the right. The gray inset makes the current task visibly different from the card around it.

The official setup guide supplies expandable steps and completion tracking. Its example separates each step's checkbox from its chevron. The description and primary action belong inside the expanded step. Insignia should retain this distinction: checking a step changes manual progress; expanding it shows detail; dismissing the guide hides education. None should silently establish product publication or theme activation. A bullet list with one general destination does not reproduce this composition.

Forms shows a compact shared metrics band split by vertical dividers. Search & Discovery shows two compact metric cards per row, each with a small label, value and lower-right line chart. The metric labels have definition affordances, and the date range belongs to the group heading. Use those native observations for visual density and chart placement. The public metrics composition documents responsive metric columns and optional historical indicators; it does not itself establish a required sparkline.

For Insignia's chosen compact-chart direction, labels, figures and small charts should form one restrained analytical band. The shared period should stay immediately above that band. Put definitions and excluded-order rules in the metric definition disclosure. Do not spend a separate line on the rejected exclusion sentence.

Use familiar `Recent customized orders` beside `View all orders`. The owner rejected the prior explanatory caption. Neither native reference establishes a numeric latest-five title; imposing one would be an inference, not fidelity to the observed source. Current artwork work must remain separately visible even when it falls outside the five recent records.

## Review status

Initial pixel review inspected the 20:32 captures. The owner then requested further native Orders comparison, a purposeful initial no-orders experience and a decision about charts on every metric. The final review below supersedes the earlier card-based metrics assessment.

Reviewed the corrected 20:46 and 20:47 local captures under `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/home/` against the Search & Discovery, Forms and Superfunny Orders images. Inspected all six initial stages at desktop and 390 px: unconfigured, no Shopify products, draft, published with theme pending, test invitation and setup complete with no orders. Also inspected first-use and no-products at 320 px, operating at desktop and 390 px, and product-creation busy/error at desktop and 390 px. No 320 px test-invitation capture was available, so that exact state is not independently pixel-qualified at 320 px.

The correction is visible in the pixels. The guide now has dashed completion rings, separate chevrons, a subdued expanded task, a task-specific primary action, completed checkmarks and a readable progress count and bar. The count fits beside dismissal and collapse controls at 320 px. It follows the observed native hierarchy rather than merely replacing the bullets with different text. The absence of an illustration is acceptable here because no Insignia teaching asset was supplied, and the short task detail and action explain the work.

Superfunny Orders uses a single unboxed strip with small dotted-underlined labels, counts/trends at left, tiny charts at right and subtle vertical separators. The final Home uses one compact two-cell band for customized orders and items, retaining that label/value/chart relationship and separator rather than three independent tiles. Its rounded outer section is an intentional Home framing difference, supported by the Forms shared-band precedent. The product distinct count was removed instead of forcing a non-additive daily series into another chart. Definitions and exclusions remain contextual. Initial no-orders stages show no zero metrics or flat charts.

The initial guide now leads with one meaningful action. The no-product stage offers Add product; unconfigured offers Configure product; a draft offers Continue setup and its product title; publication advances emphasis to Connect storefront; the test invitation emphasizes Test a product. One active inset and two collapsed task rows make the experience sparse but purposeful. Adding empty metrics or a second orders card would weaken the first action. The completed no-orders state has a collapsed three-completed guide and a concise no-orders panel with Test a customization, so it has a useful next action.

The 20:44 test invitation exposed a real duplicate: Test a customization in the guide and a second Test the customer flow row beneath it. I reported this independently. The final 20:46/20:47 desktop and 390 px captures remove the second row. Creation failure text and its recovery link align with the active task's description/action inset. The busy button retains its width. No clipping or competing primary action appears in those checked states.

The recent section deliberately uses `Recent customized orders` and `View all orders`. I initially suggested a numeric heading from the earlier delivery requirement, but withdrew that finding after the main agent clarified the owner's rejection and updated guidance. Neither supplied native reference supports a numeric title. `Recent` does not identify a chronological cutoff, but that ordinary recency ambiguity does not justify implementation-limit prose. The older-artwork captures visibly keep order #1043 above the five newer completed records, addressing the substantive discoverability risk. The 320 px metric definition popover remains within the viewport with readable text.

### Dashboard checklist

Auditing the visible captures against [Checklist Design's web app dashboard](https://www.checklist.design/web-app/dashboard).

| Status | Item | Reason |
| --- | --- | --- |
| Not needed here | Welcome state. A brief summary of what's happened since the last visit immediately re-orients returning users. | The activity period and work sections orient merchants without a greeting. No since-last-visit data is claimed. |
| Present | Key metrics. The numbers most relevant to the user's goals, readable without leaving the home screen. | Operating Home has a compact orders/items band with shared last-30-days context and definitions. Initial setup omits zero metrics because they do not guide the first action. |
| Present | Recent activity. The most recently created or updated items, enabling users to resume work without hunting. | Recent records and an obvious View all orders destination use familiar native treatment. No implementation-limit caption is required. |
| Present | Needs attention. Time-sensitive items requiring a decision, surfaced here instead of buried in another view. | The older-artwork captures put order #1043 in a separate Artwork to prepare section above five newer completed orders. |
| Present | Quick actions. Shortcuts to the most common tasks, accessible without navigating away. | Configure product, per-step actions and continuation links are visible. Destinations require the main agent's interaction checks. |
| Present | Empty state. The state shown when there is nothing to show yet, with a clear first action. | Initial stages have one setup action matched to actual product state. The completed no-orders state has a concise explanation and Test a customization action. |
| Not needed here | Layout control, if applicable. Controls to show, hide, or reorder widgets so the home screen matches how the user works. | Home has a fixed operational hierarchy. Guide dismissal/collapse supplies the relevant optional education control. |

### Onboarding checklist

Auditing the visible captures against [Checklist Design's web app onboarding](https://www.checklist.design/web-app/onboarding).

| Status | Item | Reason |
| --- | --- | --- |
| Present | Progress indicator. An indication of how many steps are involved and where the user currently is in the sequence. | Count, bar, completed checks and expanded current task are visible in zero, one and three-completed states. |
| Present | Welcome message. A brief message acknowledging this is a new experience and orienting the user toward what the product does. | Get started with Insignia and the task titles orient the merchant without a large welcome block. |
| Not needed here | Account setup. The minimum information needed to personalise the experience, gathered at the start. | Shopify provides the merchant's account context; no extra profile form is justified. |
| Present | Product highlights. Key features introduced through short contextual tips or a visual walkthrough. | Each expanded task explains one concrete part of the workflow. |
| Present | First action prompt. A clear prompt directing the user to an action or feature. | The active task has one primary action. |
| Present | Completion confirmation. A clear acknowledgement that setup is complete, transitioning the user into the main product. | The completion capture shows three checked steps and `3 of 3 complete`; Home work remains available below. This acknowledges manual guide progress, not publication or theme activation. |

## Owner correction and final illustrated first use

The owner later rejected the added `From design to production` icon columns as filler and asked for relevant illustrations/examples. My earlier review was too narrow. It confirmed a native checklist, clear action and intact layout but did not establish that the screen showed enough of Insignia's product to make first use understandable. That earlier disposition did not satisfy the owner's visual request.

I reopened the native Search & Discovery and Flow first-use captures, then freshly queried Shopify's empty-state, media-card and setup-guide guidance. Search & Discovery puts a task-specific visual beside active guidance. Flow gives a recognizable workflow illustration and actionable real templates. Neither supports filling empty space with generic benefit columns. Public media-card guidance pairs visuals with actionable explanation; empty-state guidance permits a graphic with a short explanation and first action. A visual must teach the task or outcome.

I inspected the two new bundled PNG assets and their source record, `apps/web/public/examples/home/SOURCE.txt`. They are actual shared-renderer outputs of the synthetic #1042 navy shirt, showing small front artwork and larger back artwork. These are more relevant than a generic Shopify asset because the visual shows Insignia's real configured artwork placement. `Example customization` distinguishes this sample from the merchant's own empty catalog. No controls or fabricated screen are depicted. The source record retains the underlying fixture photograph provenance.

Final 22:21 captures were inspected directly at 1440, 390 and 320 px for no-products, first-use and quiet-no-orders. The active first task now places the real front/back result beside task copy and action on desktop. The copy begins directly beneath the heading, correcting the earlier vertically centered gap. On phones one larger back view makes the applied artwork clear rather than compressing two examples into tiny thumbnails. The primary setup action appears before the image and remains visible within the short 320 px viewport. The artwork itself reads as a placement example; reading the shirt's small decorative lettering is not needed to understand that result.

The completed no-orders screen uses the relevant example, a concise absence message and `Open test instructions`. It offers a truthful next action without claiming to launch a live customization directly. The generic journey columns are gone. The final first-use screen supplies a concrete product outcome and a next task in one composition; it is not justified merely by correct padding or the presence of a picture.

No material visual correction remains in these final inspected captures. This is an independent visual comparison of local rendered output. It is not a claim of native Shopify deployment, verified interaction behavior or owner acceptance.

## Subsequent owner rejection supersedes the photo disposition

The owner rejected the illustrated version after that pixel review. They identified the garment category assumption, filler, repetition of the same UI element and insufficient comparison across multiple references. The photo approval above did not establish relevance or owner acceptance. I treated an accurate renderer output and readable placement example as sufficient justification for introducing a sample garment into a generic product setup task. That inference was wrong for the owner's scope. A truthful picture can still add an unsupported category assumption or repeat what the task guide already explains.

The sample component and bundled assets were subsequently removed. The short introduction and setup guide were restored. The [first-use restoration research](home-first-use-restoration-research-2026-10-26.md) records the newer four-reference comparison, Shopify content and optional-graphic guidance, and Checklist Design/Vercel checks. Its conclusion supersedes my illustration recommendation and the preceding no-material-correction disposition. The earlier paragraphs remain as review history, not approval of the restored result or evidence that the rejected imagery should return.

## Dismissed guidance and native orders illustration

The owner's next explicit request was to improve the dismissed-guide state, find a fitting Shopify illustration specifically for `No customized orders yet`, and reassess `Open test instructions`.

I inspected official Polaris source/examples, Shopify's Subscriptions reference app assets and the actual supplied first-party app captures. The classic CDN `empty-state.svg` proved to be sunglasses, a coupon and a turtle, so I rejected it despite its common appearance in tutorials. Files/document art, contract UI screenshots, payment art and generic product examples did not depict the missing orders resource. Official PackageIcon and OrderIcon glyphs were semantically possible fallbacks, but they are not full illustrations. The archived Polaris repository license applies to those repository assets; it does not grant rights to every modern Shopify CDN graphic.

The main agent found the exact modern graphic in the native Draft orders empty state. I inspected both `/Users/pc/Development/Insignia/.artifacts/home-research-2026-10-26/native-draft-orders-empty.png` and the [official CDN SVG](https://shopify-assets.shopifycdn.com/shopifycloud/web/assets/v1/vite/client/en/assets/empty-state-orders-e08317223bd1.svg). Its dominant subject is an incoming tray holding an order record. It contains a small red shirt thumbnail inside that record, a fact this review does not hide. This is a stock order illustration observed in native Orders, not a full sample garment presented as Insignia's target category. The implementation references the exact official CDN URL. This observation establishes source provenance and contextual use, not a separate reuse license. Do not apply the archived Polaris license to it.

I reviewed the final 22:46 dismissed no-products and quiet-no-orders captures at desktop, 390 px and 320 px, and the restored first-use desktop capture. Dismissed guidance now leaves a compact Products section with one left-aligned task/description and Add product action, stacking naturally on phones. It no longer expands that single task into a giant centered educational prompt. Show getting started remains secondary.

The quiet state uses the native order illustration at a constrained 180 px viewport, then the missing-orders heading, a brief checkout explanation and one action. Comparing the first capture against native exposed an extra 16 px gap beyond the SVG's intrinsic whitespace. I reported that spacing concern; the final capture removes it. The remaining image-to-text whitespace comes from the same SVG and matches the native grouping. Text and action stay visible and unclipped at 320 px.

Source inspection confirms that the empty-state Test a product action requires a published customized product and no outstanding non-test setup task. The guide receives the same readiness fact; its future Test action has no href, is disabled and explains the prerequisite until ready. The destination is `/admin/settings/storefront#test-product`, which wraps the existing native test section including its heading. The wrapper is the scroll and focus target. End-to-end handoff behavior remains the main agent's test evidence rather than an inference from these pixels.

No remaining concrete pixel concern was found in this final pass. This disposition applies to the inspected local captures and source scope only. It does not establish native deployment, broad design approval or owner acceptance.

## Latest hierarchy, framing and workflow correction

The owner subsequently questioned guide-before-metrics ordering, asked whether the setup guide needed a different frame, requested that dismissed product setup use the same illustrated empty-state composition as orders, rejected testing as the primary no-orders task, and questioned the detached restore control. Those corrections supersede the preceding compact-product-card and Test a product dispositions.

Fresh official setup-guide results show an ordinary outer section and, in that composition, a bordered inner step group. The homepage example instead places rows and dividers directly within the section. The saved native Search & Discovery capture shows an ordinary rounded guide with a subdued active task, not a uniquely colored or dashed outer frame. These are alternatives, not evidence that every setup guide needs a second border. The implementation retains a normal section, title-led header, row dividers and subdued expanded task. Operating metrics now lead the guide; the one Search & Discovery onboarding example does not override the owner's ordering preference for an operating Home.

For product creation I found and inspected [Shopify's archived product-record illustration](https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/public/images/examples/emptystate-files-product.png). It contains a generic gold geometric thumbnail and a plus badge, with no garment or other product-category assumption. The repository's [license notice](https://raw.githubusercontent.com/Shopify/polaris/main/LICENSE.md) permits use in Shopify-integrating applications with the copyright and permission notice retained. The local asset and notice now live under `apps/web/public/illustrations/shopify/`. This is repository-backed provenance, distinct from the modern Orders CDN graphic's provenance above.

Reviewed the final 23:04/23:05 desktop, 390 px and 320 px dismissed no-products captures, operating desktop, quiet-no-orders at 320 px and expanded guide at 320 px. The product graphic initially enlarged despite a CSS rule on the native image host. The final separate 156 by 155 px wrapper within the 180 px graphic area removes that upscale; the raster is visibly smaller and clearer. Product and order absence now share centered illustration, heading, explanation and one primary action. The product illustration's plus and neutral thumbnail identify creation rather than repeating the orders tray.

The ready no-orders action is now Configure product, beginning the supported merchant configuration workflow. Draft and pending theme work retain their own destinations instead of duplicating them with that action. Optional testing remains in the guide. Setup guide restoration is a page secondary action, moving into the native overflow on phones; no detached footer control remains. Source inspection confirms delayed restoration focus after the native menu closes. Its actual keyboard/menu behavior is covered by the main agent's browser checks, not by the static images alone.

One deliberate duplication remains when the operating guide is expanded: its contextual Continue setup task and the Product drafts overview can point to the same draft. I raised this explicitly. It is retained as contextual guidance beside an independently available resource overview, rather than being treated as two separate tasks. It does not block this requested hierarchy/framing correction.

No remaining concrete visual correction was identified in this inspected pass. This is a bounded local source/pixel review, not owner acceptance or deployment approval.

## Final polish after the logic audit

27 October 2026. The owner liked Home and requested polish to the unpadded square metric hover and the review-task hierarchy, plus a Luna Max logic audit. The main agent reported three independent audit results. I reviewed the resulting source and actual captures, without changing application source or treating fixture checks as evidence of new backend capabilities.

The metric target now uses supported native clickable padding and a large border radius. The hovered screenshot visibly shows an inset rounded background. Hover gives a short native definition tooltip. Clicking the metric opens a native modal with the selected period, total, definition, short exclusion note and retained daily data. It no longer opens a large explanatory popover containing another expandable table. Direct click to details avoids an intermediate overlay and introduces no report endpoint. This is an intentional local details interaction; native Orders uses a report link and a title-owned definition tooltip. Here the whole metric owns the brief tooltip, so exact native interaction parity is not claimed.

I raised redundant period/comparison paragraphs and the dense phone daily-row treatment. The final modal removes those paragraphs. Desktop has compact Date/Orders columns. On 390 and 320 px, supported native auto-table behavior produces date/count list-style rows with repeated metric labels removed. It is readable but is not a literal two-column phone table. The public pinned RC contract permits auto/list, despite an internal type mentioning table; retaining the supported native fallback is preferable to widening the pin or writing a custom table for this polish.

Reviewed final desktop hover/details, 390 and 320 px details, default operating guide at 320 px, returning-no-products desktop and review-task at desktop/320 px. Analytics now precedes Orders to review, with optional guidance afterwards. The task row has a precise replacement-artwork reason and Review order action; no competing Configure product page action appears in that work state. The title avoids claiming a production queue the frontend adapter cannot establish.

Source and explicit captures now cover the live default that previously differed from the operating fixture: established activity collapses guidance unless explicitly restored or overridden. Add a product replaces the historically unsafe first-product claim, including the returning-store fixture with existing order history and no current catalog. Setup guide complete names the manual guide acknowledgment rather than claiming verified product/theme state. The welcome retains one outcome sentence rather than repeating task instructions.

No remaining concrete blocking source or pixel finding was identified in this pass. Main-agent interaction tests establish selected-period row counts, Escape/focus behavior and hover execution. This review does not establish backend aggregation, derived review tasks, native deployment or owner acceptance.

### Owner-directed metric navigation supersedes details modal

The owner then explicitly requested navigation from both metrics, with no click popup and self-explanatory labels. The preceding modal assessment is historical and is superseded by that direction.

The final source uses native `s-clickable href="/admin/orders"` for both `Orders with customizations` and `Customized items ordered`. Ordered item quantities belong to Orders, so Products would be the wrong owning resource. Accessibility labels end with View orders. The metric modal/table and obsolete modal-gallery scene are removed; the period menu remains a separate supported control. Rounded padding and a brief optional native tooltip remain.

Inspected final desktop review-task and 320 px hovered-statistic captures. Both longer labels fit, the rounded hover remains inset, and the short tooltip stays within the narrow viewport. No new concrete visual issue was found. The destination is the owning Orders resource, with no claim that its filters reproduce the metric's date period or excluded-order cohort. The main agent reports pointer and Enter navigation checks for both metrics and confirmation that no metric modal opens. This small review does not establish owner acceptance or deployment.

### Recent-order row hover correction

The owner identified flush recent-order hover styling. The main agent measured the rendered [official resource-list navigation example](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/resource-list): its anchor owns 12 px vertical and 16 px horizontal padding, while the unpadded native section clips full-row hover to its outer radius.

Source review confirms populated recent orders now use an unpadded section and a native full-row clickable with real href, supported padding and top-edge separators. The order title renders without a nested link. Custom row-shell hover/focus paint is removed; task and draft compositions remain unchanged.

Inspected actual desktop last-row hover and corrected 320 px first/last-row hover captures. Fill reaches the row edges, text retains its 16 px inset, separators span the row, and top/bottom section corners clip cleanly. No stale metric tooltip obscures the final narrow captures. No concrete pixel finding remains for this correction. Main-agent tests cover pointer activation in the padding, visible keyboard focus and Enter navigation; owner acceptance and deployment remain separate.
