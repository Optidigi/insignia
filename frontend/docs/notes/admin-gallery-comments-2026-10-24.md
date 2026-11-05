# Admin gallery comment follow-up

## Field-edge follow-up

24 October 2026. The price field's clipped appearance was reproducible in the live build. The short fixed-price form still used the scroll container intended for long size-price lists. Its horizontal overflow computed to auto, and its edges coincided with the input border. Polaris paints the blue focus ring outside that border, so the scrollport cut off the ring at the left and right corners. The short form now lets the native modal own scrolling, while long price lists keep their bounded scrolling behavior. Its normal modal padding leaves room for the complete focus ring.

The Add method helper text is aligned with the field's outer border. In the live desktop measurement both started at x=470px, while the entered name started at x=482px. That 12px native input-text inset creates the perceived offset. The native helper alignment is retained; there is no separate left-margin defect to correct.

A focused browser assertion failed on the original clipping container before the change and passes afterward. Four relevant method workflows pass, covering desktop/phone price editing, cancellation, independent product prices, long chooser scrolling and 320px name-entry actions. Strict admin-test types, scoped style checks and pinned Polaris component validation pass. The editor gallery was recaptured at desktop and phone widths; Latest changes now leads with these two reviewed forms. This is a local preview correction; no production deployment occurred.

## Fourth owner review

24 October 2026. Five follow-up comments are addressed in six refreshed gallery states, including both single-order and bulk artwork downloads. The gallery opens on these latest changes; all current states and the older template implementation evidence remain available through their filters.

| Comment | Decision and change |
| --- | --- |
| Add method hierarchy | Use the modal's normal content padding so the title, input and supporting text share a left edge. The single name field retains its accessible label and a Method name placeholder; the redundant visible label is removed. This follows the public text-field contract for a label made redundant by the surrounding task. |
| Back to methods | Direct price edits open a focused Cancel/Done form. Substeps entered from the method chooser retain Back in the native footer, beside Cancel and the primary action. Back preserves staged edits and returns focus to the chooser; Cancel discards the chooser's staged changes. The short visible Back label fits at 320px; its accessible name is Back to methods. |
| Artwork export hierarchy | One warning summary gives excluded-placement and affected-order counts. Each order has a labeled section header, with test status and any exclusion count. Designs and filename/placement rows sit inside that order. A missing placement shows its name and actual omission reason together. Payment, cancellation and verification notes stay attached to their order. No directional above/below copy or repeated warning banner remains. |
| Illustration spacing | Compensate for transparent padding in Shopify's unchanged illustration through its layout container. Remove the repeated product name already present in the editor header. Photo and illustration variants now lead into the same centered heading, description and action stack. |
| Phone Methods context | Keep the phone overview free of horizontal scrolling. Each row explicitly labels Default pricing, Products using, Available to and Product setup. The method name, selection and trailing menu remain visible. This costs some vertical space but preserves the meaning of every value. The desktop comparison table retains its column headers. |

Shopify's [modal](https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal), [text-field](https://shopify.dev/docs/api/app-home/latest/web-components/forms/text-field), [index-table](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/index-table) and [content](https://shopify.dev/docs/apps/design/content) guidance govern the supported controls and copy. A fresh read-only inspection of the native Shopify theme file chooser showed a task title, controls and Cancel/Done footer. That supports the direct-task composition; it does not establish an exact native multistep Back pattern. The chooser's footer Back is an Insignia navigation decision implemented through supported secondary actions, not a claim that Shopify prescribes it.

The grouping and proximity decisions also apply [Memorisely's hierarchy lesson](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1), [Zander Whitehurst's contextual disclosure lesson](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) and the previously inspected Checklist Design [table](https://www.checklist.design/web-app/data-table), [modal](https://www.checklist.design/design-system/modal) and [empty-state](https://www.checklist.design/web-app/empty-state) checks. These principles inform the composition; the mobile trade-off and independent product pricing are product decisions.

Validation: 12 distinct relevant browser workflows pass: four placement-method workflows, four Methods overview/phone workflows and four original-artwork report/download workflows. They cover cancellation, staged edits, 320px name-entry actions, independent product prices, search/filter/selection, archive contents, omitted files, report pagination and shared originals. All three gallery capture collections pass. Strict admin-test TypeScript, scoped style checks, pinned Polaris contracts and the 147-file web build pass. The screenshot captures were rerun after an overlapping build replaced their assets; only completed captures are included.

An independent GPT-6.1 Sol reviewer at medium reasoning inspected all 12 desktop/phone screenshots and the affected source. It approved the five fixes for owner visual review with no blocking findings. It confirmed the direct-entry/chooser distinction for Back and qualified the native comparison. Fresh Shopify, Memorisely, Zander and Vercel guidance informed its review; Checklist Design returned empty text through its web tool, so that source contribution relies on the earlier recorded browser inspection. This is a design review, not an additional test run.

The richer Methods and editor changes remain local preview work pending production integration. The artwork export changes are in application source. No deployment, live store write, owner visual acceptance or release approval is claimed.

## Third owner review

Owner follow-up: the first-view guide now uses the same centered vertical stack on desktop and phone, including the product image or Shopify illustration, heading, description and action. This replaces the earlier desktop side-by-side layout at the owner's request. The main order-demo preview uses the richer Methods workflow for both `/admin/methods` and `/admin/settings/methods`. Outside that preview, the application Settings route still uses the names-only template library. Keeping both in the gallery documents the integration gap; it does not define two permanent merchant workflows.

24 October 2026. Seven further comments identified a real review regression. The gallery led with the older application Settings template library, whose API exposes only names and optimistic versions. The richer local Methods workflow still had pricing, product assignments and setup status. Presenting the smaller Settings list as the main Methods overview discarded useful context in the review. This was a screen-selection and presentation mistake, not a deliberate product simplification or a loss of the richer workflow's stored data. Product counts shown by the Methods workflow are derived from its assignments; the Settings API is not given fabricated usage counts.

The composition decisions use [Memorisely's hierarchy lesson](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1), [Checklist Design's data-table](https://www.checklist.design/web-app/data-table) and [modal](https://www.checklist.design/design-system/modal) checks, plus the previously inspected empty-state guidance and Zander's progressive disclosure. The table and modal checklists were read again in the browser. Related content stays close, the principal task gets the most space, and secondary context has a stable place. Shopify's [index-table pattern](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/index-table), [modal contracts](https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal) and real theme media picker govern the supported controls and native comparison.

| Comment | Decision and change |
| --- | --- |
| 1 | Lead with the actual Methods overview. Keep pricing, assignment counts and setup status. On phones, place pricing/setup below the method name while product counts and the row menu stay visible. Use the same short Methods title as navigation so header actions fit. The older Settings template screen remains separately identified. In both tables, align the menu control at the trailing cell edge and inset the search glyph. |
| 2 | Reuse the existing modal primary action as Retry save or Retry removal after an unconfirmed result. It sends the retained command and idempotency key. Remove the extra inline retry and disabled duplicate primary action. |
| 3 | Inspect the live native picker close button, then require the real close SVG to be visible before its gallery screenshot. Do not add a second close button or replace the component's private glyph. |
| 4 | Size the single-order download panel to its content. Use a compact order/file summary and filename rows with placement context underneath, file icons and clear separators. Keep missing-file reasons, shared-file information and paging. |
| 5 | Make the worksheet the leading content. On desktop, put structured order, item, design and format details beside the preview. Test status belongs with that context; actual production holds retain warnings. On phones, compact details precede the preview. Download and expiry/permission checks are unchanged. |
| 6 | Pair the product photo with a short explanation of what a view means and a direct Add view action. Use a 32px desktop column gap and a 24px phone image-to-copy gap. Without a product photo, reuse the existing unchanged Shopify illustration with its retained license. |
| 7 | Reinspect the native media picker's no-match state, rather than infer it from its normal grid. Shopify removes the large upload area, shows plain No results found guidance, then offers Upload image. Use the same composition with Upload image and Show all images. Keep the accepted normal upload/grid and multi-selection behavior. |

The native media comparison was performed read-only in the existing theme editor. Searching an impossible filename produced No results found, an explanatory line, Upload image and Generate image, with no illustration or full drop zone. The search was cleared afterward; no file was selected or theme saved. Insignia does not add Shopify's image-generation feature. Its no-match upload uses the same bounded image processing and selection logic as the ordinary drop zone.

Final evidence: 84 states and 167 screenshots, including 29 paired Methods states, 24 paired Orders/Products/Settings states, and 31 editor states with 61 screenshots. Latest changes filters ten relevant states, beginning with the richer Methods overview. The build checks 146 files with zero diagnostics. Strict admin-test TypeScript, scoped Biome, maintained-source checks and public Polaris contracts pass. Focused checks pass for method search/selection/phone creation, template retry with the retained key, template row/dialog behavior, first-product setup, accepted image selection and upload/recovery, worksheet PDF/download/permission/expiry behavior, and shared narrow toolbar layout. All three capture suites pass. This is focused coverage, not the full suite. Capture setup now seeds each named disposable editor fixture before navigation; older placement-count label expectations were corrected to match the existing accessible labels.

The requested independent reviewer used GPT-6.1 Sol at medium reasoning. It visually inspected both widths for all seven comments and recommended **approve for owner review**, with no blocking findings. Its initial polish findings led to coherent first-use text alignment, compact phone worksheet context, and an explicit local-preview label on the richer Methods capture. It then rechecked the resulting images and approved that recommendation. It independently read Memorisely's public transcript, current Vercel guidance, Shopify's index-table/modal docs and Checklist's data-table/empty-state content. Checklist's modal page showed an empty main region in its browser; this document relies on the parent's successful browser read for that page. The reviewer did not edit files or run tests.

These remain local source and browser results. The richer Methods/editor workflows are preview work; neither screenshot selection nor this pass integrates their production data model. Independent approval means ready for the owner's visual review, not owner acceptance or production approval.

## Second owner review

24 October 2026. The next 21 comments exposed incomplete handling of the earlier feedback. In particular, the earlier request to remove the Draft explanation had only been shortened. The reusable library still forced its table into list mode, stacking actions below names on desktop. Date selection, production-sheet hierarchy and first-product guidance needed composition changes rather than copy edits. This review supersedes those first-pass descriptions below.

The original product-design references were recovered from the conversation: Memorisely and Zander Whitehurst, Checklist Design, and Vercel's interface guidance. Shopify's actual admin and public Polaris contracts remain the component reference. These sources inform task and layout decisions, not a claim of owner acceptance.

[Memorisely's public hierarchy lesson](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) was inspected through its public transcript and an initial video frame. It groups and prioritizes actual content before choosing layout, then uses proximity, alignment and restrained emphasis to make those relationships legible. Further video interaction displayed a sign-in gate, so this review does not claim a complete video viewing or access to the paid course. [Zander's progressive-disclosure post](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX) supports showing information when the task needs it.

The actual [Checklist Design table](https://www.checklist.design/design-system/table), [data-table](https://www.checklist.design/web-app/data-table), [modal](https://www.checklist.design/design-system/modal) and [empty-state](https://www.checklist.design/web-app/empty-state) pages were read in the browser. Their relevant checks are coherent columns and row spacing, nearby resource actions, predictable modal actions, contextual empty-state content, a direct first action, and separate handling of search emptiness and loading errors. This does not justify adding filtering, exporting or bulk operations that the underlying library cannot support. The [date-picker checklist](https://www.checklist.design/design-system/date-picker) also informed retaining editable historical dates alongside the inline calendar. Vercel's current interface guidance supplies supplementary checks for focus, overflow, labels and responsive behavior.

| New comments | Change under review |
| --- | --- |
| 1 | Resource-specific delete title; the body states the assignment consequence once. |
| 2–4 | One aligned preset list, editable From/To fields above a supported inline range calendar, and a wider Orders filter panel; retain the compact public filter button. |
| 5–7 | Group artwork files by order and design, remove Copy order numbers and its now-redundant desktop menu, and rebuild production-sheet context and printed hierarchy. |
| 8–9 | Left-align replacement actions with the upload content; retain explicit labels for file actions. |
| 10 | Inset and bound unavailable-assignment empty-state text. |
| 11 | Keep collection help with search, omit zero-selection footer clutter, and expose Clear selection only when useful. |
| 12–13 | Keep upload before image results in every state; remove transient pointer hover from captures of unselected images. |
| 14 | Remove the Draft explanation popover. |
| 15 | Put Clear measurement beside Redraw line in the visible measurement action row. |
| 16–17 | Use one central first-view task with the real product image; remove duplicate outline instructions and give the publication blocker a direct Add view action. |
| 18–21 | Rebuild the reusable library with the shared overview table, aligned trailing row menus, search and short edit dialogs. Remove the permanent Refresh library action and duplicate background error while an edit dialog is open. |

The reusable library exposes only names and resource actions because its authenticated API supplies reusable method names and versions, not the richer local Methods workflow's product assignment/pricing data. Both desktop and phone retain two aligned table columns. The shared table's spacing, borders and public controls follow the rest of the overviews. Existing setups retain independent method copies. A contextual read retry or lost-response retry remains available on an actual error, retaining the original command identity in the mounted session; no routine refresh action is added back. The pending command is held in memory, so this review does not claim recovery across a reload or unmount.

The second review contains 82 states and 163 screenshots: 81 desktop/phone pairs and one desktop-only Draft status. The phone header has no separate Draft label. The new first-product page has its own pair, and the 320×568 no-results upload capture checks the initial visible upload area above the pinned action. The first-review evidence below remains historical. Final captures passed for all three areas: 28 paired Methods states, 24 paired Orders/Products/Settings states, and 30 editor states with 59 images. The production web build passed with 146 checked files and zero diagnostics. Eight focused Orders workflows and nine editor workflows passed, along with the library, shared-toolbar and import/retry checks. Strict admin-test TypeScript, scoped Biome, maintained-source checks and public Polaris contracts pass. This is focused regression coverage, not the full application suite. The final report records actual PNG dimensions; the portable ZIP was checked against the current manifest and image bytes.

## First review

24 October 2026. This pass addresses the owner's gallery feedback using the logged-in Shopify Orders and theme media picker as the primary visual references. Add views remains owner-accepted. Its selection behavior is unchanged.

## Shared controls and Products

The phone filter now renders a real icon-only Polaris button. Hiding a desktop button's text left a wider hit area and hover background. Desktop and phone controls share the same action and accessible name. Resource table clipping follows the visible scroll viewport, including the right edge of a horizontally scrolling phone header and the selection row. The local host uses consistent typography and lets native save/discard controls own their dimensions rather than clipping their inner buttons.

Products no longer repeats an eye action beside every row or offers Copy product IDs. Selecting one product exposes Customer preview in the selection toolbar, or the phone Actions menu. The existing preview bridge still opens a frozen local setup without saving or publishing it. Selection, configuration links and the selected-product summary download retain their existing scope.

## Orders, comments 11–18

Artwork status, date presets and custom date fields remain in one filter popover. Date direction is a direct choice in Display options. Shopify's native display panel supports nested sorting menus, but Insignia exposes only one sort field, so a second menu adds no choice.

Artwork exports identify the ZIP, selected order count, ready files and missing-file reasons. Ready results offer Download and Close. Prepare again is reserved for actual failure or expired access. Upload replacement has explicit Replace artwork and Cancel actions near the upload control.

Production sheet previews appear when preparation completes. The shared preview bounds the rendered page and provides page selection. Batch review places the preview beside the selected-order summary where space permits, then stacks them on phones. Preparation, access expiry, missing artwork and retry behavior remain distinct.

## Methods and selection, comments 19–24 and 41–43

Show selected is an explicit view action. The separate page checkbox selects results. Filter detail screens have a contextual Back control, title and Clear action. Tag controls have room for their full checkbox; collection headings and product counts share aligned columns.

Empty catalogs preserve existing assignments whose IDs are unavailable. The picker explains those assignments and disables an unchanged Select action. Clearing them remains an explicit action. Resource empty states use the public Polaris graphic slot and concise task copy.

The reusable MethodLibrary uses a native list table and a contextual menu per method. The old About sidebar is replaced by one short explanation of independent product copies. Removal names the method and its consequence, with a direct Remove method action. Existing product setups and orders remain independent.

## Illustration choice

The owner's follow-up asked specifically about Puzzlify and Shopify Flow. The current [Puzzlify homepage example](https://shopify.dev/docs/api/app-home/latest/patterns/templates/homepage) supplies puzzle templates and a callout image of a puzzle piece and character. It is subject-specific example artwork, rather than evidence of a general illustration component. Shopify's [visual design guidance](https://shopify.dev/docs/apps/design/visual-design) recommends meaningful metaphors and a consistent app illustration style. The old linked illustration-guidelines URL currently redirects to the Polaris API landing page. A Shopify staff clarification on 27 November 2025 also calls the old page outdated and says there was no planned app illustration guidance. This investigation did not establish a current public, general-purpose illustration catalog.

The logged-in Flow app and Recent runs route both left their embedded content blank after a retry. No live Flow empty-state claim follows from that failed load. Shopify's own [Flow listing screenshots](https://apps.shopify.com/flow) provide a fallback reference: its template browser uses an automation illustration near its introductory heading, while the task controls and repeated results use compact icons.

The resulting choice is Shopify's neutral records illustration for the first-use Methods page, with public resource or search icons in compact picker states. The archived official repository also includes a records illustration with an add symbol and an empty-search SVG; these are reusable static assets, not a current illustration web component or general asset service. The neutral records image fits a library of reusable defaults without importing Flow branding or Puzzlify's puzzle artwork. Its empty-state heading and action carry the meaning. Filtered results and operational errors remain concise.

The unchanged asset is vendored at `apps/web/public/illustrations/shopify/empty-records.png` from [Shopify's archived Polaris examples](https://github.com/Shopify/polaris-react-archive/blob/3f7954ae42fabf26d63cee68c23ceebfd7ef0972/polaris.shopify.com/public/images/examples/emptystate-files.png). The source commit, SHA-256 and original license are retained with the asset. Its SHA-256 is `10e84ca8d3fdd88f32333547e6f9902f919a924d295913dae64bbe1ff91f5268`. Only the static image is reused; the archived React implementation is not installed. See the [Shopify staff clarification](https://community.shopify.dev/t/illustration-guidelines-update/26288) for the limits of older illustration guidance.

## Product editor, comments 25–38

Phone canvas help describes touch controls; desktop retains keyboard shortcuts. View and placement context share one compact header line. View settings give the image and its change action a deliberate position, and Artwork area keeps a visible gap before Draw area.

Change image retains its image grid and mutually exclusive radio semantics. The logged-in Shopify theme picker also presents images in a grid, using checkbox styling for its file workflow. This comparison does not require converting the accepted Add views flow or hiding image choices in a list.

Copy setup keeps a stable task title, compact destination and view summaries, and clear navigation between destination selection and review. Success aggregates copied products and provides a direct review action for one destination; partial failures retain their retry path and configured-target protection. Large recipient sets retain search and paging.

Draft help separates Save draft and Publish in a short explanation. Publication blockers expose their specific recovery actions instead of repeating a generic Review setup footer. Valid publication review shows the product and view/placement summary. The decoration-method manager's placement scope, enabled count, catalog filtering and method-specific price editing were reviewed and retained.

## Native geometry and source limits

At 390×844 the actual Shopify Orders export is a full-width bottom sheet with square top corners and stacked actions. The public Polaris RC component in this local preview can render a centered rounded dialog instead. A diagnostic confirmed a 390px-wide app iframe, a hidden demo footer and no project override of the modal frame. That difference belongs to the supported component's output; this pass does not patch private shadow styles to imitate Shopify's internal implementation.

The local demo footer is excluded only while capturing gallery images. It is restored afterward. It is not part of the merchant application. Native operating-system select lists and external Shopify dialogs are outside this gallery.

The owner's later question about bottom sheets was checked against the current public API, rather than extrapolating from one native screen. Shopify's [App Home modal documentation](https://shopify.dev/docs/api/app-home/latest/web-components/overlays/modal) describes centered placement and exposes size choices, not a position control. Its [App window guidance](https://shopify.dev/docs/api/app-home/latest/app-bridge-web-components/app-window) recommends the ordinary Polaris modal for most dialogs, with a separate fullscreen route for complex workflows. A Checkout or Customer Account Sheet component is a different API target and is not a supported substitute in this App Home app.

| Task | Choice in this pass |
| --- | --- |
| Filters, sorting and contextual help | Keep a public popover near the trigger. |
| Removal and publication confirmation | Use a compact public modal sized to the decision. |
| Product/media selection and copy review | Use a roomier public modal with scrolling and available actions. |
| Production PDF review | Use a wide public modal, two columns when space permits and one column on phones. |
| A dedicated immersive editor | A host-owned App window is available for a future integrated workflow; this pass does not migrate the local editor into a new host route. |

The observed native Orders export itself changes from a centered desktop dialog to a phone sheet. That supports adapting to the task and host, rather than making every overlay a bottom sheet. The current components retain their public positioning behavior. Content height, scrolling, focus and action reachability are the application responsibilities verified here.

Sources used:

- [Polaris modal API](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/overlays/modal), including native content scrolling and slotted actions.
- [Polaris empty-state API](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/feedback-and-status-indicators/empty-state), including its graphic and subheading slots.
- [Shopify popover migration guidance](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/popover).
- [Shopify modal migration guidance](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/modal).
- [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) and [Checklist Design modal checklist](https://www.checklist.design/design-system/modal) and [empty-state checklist](https://www.checklist.design/web-app/empty-state) as supplementary interaction guidance. Shopify governs component choice and composition. Public Memorisely material did not supply detailed implementation guidance, so no private-course claims are attributed to it.

The runtime remains `polaris-2.0-rc.js` and types remain `2.0.0-rc.3`. The toolkit resolves the requested `2.0-rc` catalog to `v2.0`. Contract validation establishes supported public props; it does not establish visual acceptance.

## Review evidence

The refreshed gallery contains 81 states and 162 screenshots. Desktop captures are 1440×1000. Phone captures are 390×844 except the explicitly labeled 320×568 Add views upload check. Each image caption and the portable manifest record its actual dimensions. Four additional customer-preview images are included in the portable ZIP. The report reads the capture harnesses' canonical manifests so an older copied manifest cannot replace a fresh image or description.

The gallery is served at `http://127.0.0.1:62168/__preview/popup-review/`. The portable folder and ZIP are in the workspace-root `.artifacts/admin-popup-review-2026-10-24/`. The ZIP includes relative image references, a README and the illustration's source/license record.

Relevant browser checks cover shared toolbar widths and focus, Products selection/filter/search and download scope, the real customer-preview bridge at desktop and phone widths, method library and picker flows, mobile save/discard bounds, Orders date/sort and PDF preparation, editor recovery/copy/publication, and short-phone upload scrolling. Capture assertions check real image decoding, PDF pixels, batch columns, modal footer reachability and temporary exclusion/restoration of demo controls. The production web build, strict admin-test TypeScript, scoped Biome and maintained-source check pass. Public Polaris contract checks cover the changed components; standalone whole-island validation cannot resolve some imported application guards, so changed public markup is checked separately alongside the real compiler projects.

Three independent reviewers covered Orders, Methods and editor changes, with cross-review of shared controls and the resulting screenshots. Their review found several issues corrected during this pass, including a PDF grid responsive-value parse failure, short-phone clipping and a preview route missing the illustration. Review and browser evidence remain local; they do not establish owner acceptance or production deployment. This was a focused regression pass, not the full application test suite.

## Delivery scope

Shared controls, Products, Orders and MethodLibrary changes are application source. The newer placement editor and Methods workflow remain local preview work. Captures and tests use isolated browser contexts and local fixtures. No Shopify product, production configuration, order or storefront write was made. The masking experiment remains separate. Implementation and local verification do not imply owner acceptance or release approval.
