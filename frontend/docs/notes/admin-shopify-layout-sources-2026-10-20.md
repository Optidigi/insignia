# Shopify sources for the admin layout proposal

Research date: 20 October 2026. This note supports an information architecture proposal, not an implementation. The current UI supplies capabilities and constraints through the [capability inventory](admin-capability-research-2026-10-20.md); it supplies no visual precedent. Shopify's official `shopify` skill, `polaris-app-home` topic, and its versioned documentation search were used. The target remains iframe App Home with Astro and Preact, not the separately hosted App Home extension. The documentation still identifies Polaris 2.0 as a release candidate. [Polaris patterns](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns)

## Navigation rules that affect the proposal

Shopify says to organize around merchant tasks, use few categories and short noun labels, provide back navigation, and keep page-header actions specific to the page. Tabs are secondary navigation and should only replace the content beneath them. The app's home destination must not appear twice. Main navigation should not be repeated as a second navigation bar or grid in the body. [Navigation](https://shopify.dev/docs/apps/design/navigation)

The current App nav reference documents link children in a flat menu. It does not document nested sidebar groups. On desktop these links appear in Shopify's sidebar; on Shopify mobile they appear in its title-bar dropdown. The app name already opens the home route. A hidden `rel="home"` link can change that destination. Plan deeper pages inside the app rather than assuming a custom multi-level Shopify sidebar. This is a conclusion about the documented API, not a claim about every possible host behavior. [App nav](https://shopify.dev/docs/api/app-home/v2.0-rc/app-bridge-web-components/app-nav)

For Insignia, recommend visible Products, Orders, Settings links and a distinct, concise Overview page opened through the app name. A suggested home route is `/admin`; this is a proposal, while the current root redirects to Products. Overview should contain real setup tasks and actionable exceptions. It needs honest status/aggregate reads and must not repeat all navigation as a card grid. If implementation instead keeps home at Products, avoid a second visible Products link pointing at the same destination. The separate Overview is an Insignia design recommendation, not a Shopify requirement.

## Screen and section patterns

| Insignia task | Shopify pattern and consequence |
| --- | --- |
| Find configured/catalog products or customized orders | Use an index page for a resource collection. The pattern supports searchable/filterable tables and entry into detail pages. Its bulk-action examples do not establish that Insignia supports bulk mutations. [Index](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/resource-index) |
| Configure a product; prepare a purchased design's artwork | Use a resource details page. Put definition/editing in the primary column, supporting status/context in the secondary column, and provide a breadcrumb. Give related fields named sections, with section actions in the section header. [Details](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/details) |
| Edit images and placement geometry | Shopify explicitly recommends two columns for visual editors so merchants can preview edits. Resource indexes can use full width. A small settings form need not inherit either layout. Collapse appropriately for narrow screens. [Layout](https://shopify.dev/docs/apps/design/layout) |
| Maintain reusable methods, theme integration, billing, privacy, readiness | Use a Settings overview with drill-down rows to focused settings pages. Interstitial navigation is specifically intended to reveal deeper pages without filling the main menu. [Interstitial nav](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/compositions/interstitial-nav) |
| Edit an individual settings group | Group related options with local help and protect edits with Save Bar. In Polaris 2.0, section heading/subheading/status/action slots carry that hierarchy. [Settings](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/settings) |
| First-time setup | A setup checklist belongs on a useful home or onboarding page. Complete a task when it finishes, not merely when its link is clicked. The Insignia theme link currently cannot verify installation. [Setup guide](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/compositions/setup-guide) |

A useful home is an entry point for attention items, setup and actions. Its sample dashboard is an example composition, not a requirement to add revenue charts, news, app promotions or metric cards. Insignia currently lacks a qualified global summary API, so a home proposal must identify which information can actually be supplied. [Homepage](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/templates/homepage)

## Product editor recommendation

This is an Insignia-specific inference from the patterns and domain inventory, not a Shopify-prescribed screen map.

- Keep a stable product header and status context while editing that product.
- Organize its work into customization rules, visual specification, prices, and review/publication. Exact names and the number of screens need a narrow-screen prototype.
- Keep placements and decoration sizes near their product view and visual preview. Keep product variant image/geometry overrides in the same context as the default they override.
- Put production choices and merchant-supplied artwork-later policy with customization rules. Do not bury product-specific policy in global Settings.
- Prices need the method/placement/decoration-size context and exact currency amounts, with missing values and explicit zero distinguished. Review must show the selected decoration sum.
- Offer preview and readiness from the product context. Keep save/discard and publication separate, because saving a draft cannot make it active.
- Prefer progressive disclosure for conditional fields and overrides. Use a guided initial setup only where dependencies require order. Returning merchants should reach an existing price or placement directly, rather than replay a mandatory wizard.

Shopify recommends a dedicated page for an object's definition, titled sections once a form exceeds five inputs, conditional disclosure for dependent inputs, and room for large forms instead of oversized modals. Its guidance favors explicit Save Bar saving over continuous validation or autosave. [Forms](https://shopify.dev/docs/apps/design/user-experience/forms)

A long row of tab labels is a poor default for this editor. A sectioned details page, separate focused subpage, or a small stable secondary navigation can be tested against the actual field count. If tabs are selected, they must fit without wrapping and keep the product header fixed. [Navigation](https://shopify.dev/docs/apps/design/navigation)

## Save, preview and dialogs

Choose automatic form-driven Save Bar or programmatic Save Bar per editing context. Do not combine both for the same form. Programmatic state control is available for canvas/custom state, and leave confirmation is available before custom navigation. For Insignia, whichever mechanism is selected must preserve the existing uncertain-write and conflict recovery, not simply hide the bar on an HTTP response. [Save Bar API](https://shopify.dev/docs/api/app-home/v2.0-rc/apis/user-interface-and-interactions/save-bar-api)

An app-window form needs its own Save Bar inside that window. The parent's bar otherwise remains behind it. [Save bar](https://shopify.dev/docs/api/app-home/v2.0-rc/app-bridge-web-components/save-bar)

Use focused confirmation dialogs for consequential actions such as irreversible artwork locking or discarding extensive edits. Shopify says to explain destructive consequences, use specific action labels, avoid nested modals, and use modals sparingly. Keep routine editing on the page. A product preview may deserve a full page/app window if it needs extensive interaction; a modal should not become a second large editor. [Modal](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/overlays/modal), [Forms](https://shopify.dev/docs/apps/design/user-experience/forms)

## States belong to the affected task

Shopify puts field errors below the field, section errors at the affected section, and broad blocking errors higher up. Avoid errors while merchants are still typing and avoid modal error popups. Use brief success toasts for immediate non-critical confirmation; persistent status or recovery needs persistent presentation. A badge can flag an exception in a list, but color alone cannot explain it. [Alerts](https://shopify.dev/docs/apps/design/user-experience/alerts)

Apply those rules to Insignia's actual independent states: draft dirty/saving/conflict/unknown outcome; publication requested/pending/active/recovery; artwork uploading/processing/rejected/attached/locked/expired; and access denied or retained detail unavailable. Do not squash them into one generic green/red status. These exact state names and distinctions come from the capability inventory, not the Shopify source.

For each index and detail screen, design normal, first-use empty, no-results, loading, unavailable, denied and expired-content states where meaningful. Preserve the project's silent accessible skeleton requirement. Do not treat a failed read as an empty collection. This state coverage is a project proposal.

## Copy constraints

Match the Shopify admin voice, avoid duplicated page titles/navigation, write short plain sentences, use one consistent term for each concept and start actions with a useful verb. Explain consequences at the decision point. Do not add a tagline below every page heading. [Content](https://shopify.dev/docs/apps/design/content)

Suggested vocabulary to validate with the owner: Products, Orders, Settings, Decoration methods, Decoration sizes, Production artwork, Save draft, Review, Publish, Download original. Keep garment size separate from decoration size, original artwork separate from replacement, and current purchase detail separate from the historical purchased design.

## Verification limits

Public primary pages above were opened on the research date. Shopify toolkit searches targeted `polaris-app-home` version `2.0-rc`; a later broad search located design guidance beyond that API catalog. No UI code was generated, so component-code validation was not applicable. There were no native store reads/writes, local application changes, browser observations or design acceptance in this research.
