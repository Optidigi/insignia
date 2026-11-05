# Customizer reference notes

Updated 20 October 2026. The design follows the user's priorities and the references below. Numeric values and control arrangements are prototype decisions, not universal UX or accessibility requirements.

## Source order

- Primary visual references: [Memorisely on readable visual hierarchy](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) and [Zander Whitehurst on theme variables](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-figma-activity-7092391375173730304-0LPt). Use these for hierarchy and token thinking; the editor's exact layout and values remain local choices.
- The relevant [Checklist Design public pages](https://www.checklist.design/) were retrieved from its public API: [input field](https://www.checklist.design/design-system/input-field), [table](https://www.checklist.design/design-system/table), [tokens](https://www.checklist.design/design-system/tokens), [submitting a form](https://www.checklist.design/flows/submitting-a-form), and [showing an input error](https://www.checklist.design/flows/showing-input-error). They inform the corresponding form, table, theme, and recovery reviews.
- [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) support interaction checks such as semantic controls, named icon buttons, visible keyboard focus, reduced motion, safe areas, and keeping sticky controls clear of focused fields.
- W3C and GOV.UK references support accessible semantics and behavior. They do not prescribe this editor's layout, palette, dimensions, or interaction choices.

## Current design choices

- Artwork focus uses a moderate 1.4× zoom.
- Quantity fields show a visible `0` placeholder, with 44px control height and 16px text. These values are local choices.
- Review uses descriptive artwork rows and full-width colour/size quantity summaries. Placement prices are in one expandable unit-price breakdown; the order total appears in the footer. Section Edit actions remain visible, and each artwork row also opens its specific placement.
- Invalid submission focuses an error summary. Each invalid field also has an adjacent message, and the footer shows the issue count.
- Appearance offers Light and Dark. With no manual choice, the effective theme follows the device setting. Explicit choices persist where storage is allowed and survive app navigation in memory otherwise. Theme tokens affect the interface; source media keep a stable light colour scheme.
- On phones, keep the garment preview above the active controls and leave the quantity form scrollable with the keyboard open. Preserve browser zoom and reduced-motion settings.

## Review scope

Cover first visit, upload success and failure recovery, long labels and filenames, large colour lists, quantity correction, review edits, browser zoom, keyboard navigation, short windows, and all three theme choices. Browser viewport captures do not verify physical phone keyboards or native select popups; those need device checks. Full translation and RTL behavior also remain outside this English-led fixture set.


## Neutral dark theme and simpler Review

The follow-up uses [Vercel Geist colours](https://vercel.com/geist/colors) as the primary palette guidance. It explicitly separates greys for ordinary UI, component backgrounds, default/hover/active borders, text and high-contrast fills. Insignia uses #181818 for the preview, #212121 for the main panel, #292929 for hover surfaces, #373737 for ordinary dividers, #737373 for field borders and #e6e6e6 for primary fills. Those exact values are our choices, not a claim to reproduce Codex, ChatGPT or Perplexity's palettes. Error/warning/success colours retain their status roles. Canvas selection uses a dark/light contrast pair in dark mode; supplied product images are not recoloured.

[Geist Entity](https://vercel.com/geist/entity) distinguishes descriptive rows from comparable table data, and [Geist Description](https://vercel.com/geist/description) covers key/value metadata. That distinction led to artwork rows, colour groups with semantic size/quantity definition lists, and one expandable pricing definition list. Repeated per-placement Edit text and colour-level prices were removed. This is a specific editor layout choice, not a rule that order summaries can never use tables.

Desktop step badges use the same fixed box for digits and checks, lining/tabular numerals and an explicit line height of 1. This applies [Vercel's alignment guidance](https://vercel.com/design/guidelines#layout). Mobile continues to omit badges so the labels have room to wrap.


## Theme implementation audit

The audit is recorded in [DARK-MODE-REVIEW.md](DARK-MODE-REVIEW.md). [Geist colours](https://vercel.com/geist/colors) remains the primary reference for role-based backgrounds, borders and text. [Vercel interface guidelines](https://vercel.com/design/guidelines) informs visible focus, native-select colours and document theme configuration. [web.dev's implementation guide](https://web.dev/articles/prefers-color-scheme) supports early theme detection and explicit user overrides.

Geist's own Theme Switcher shows three choices. The user explicitly requested two, so this prototype keeps device detection implicit and displays only the resolved Light/Dark state. It follows the device until a manual choice is made. This product choice should not be attributed to Geist as its prescribed picker design.

The review led to stronger light focus/input contrast, an explicit native-select background, one shared theme store, head-time theme resolution, forced-colour selection/focus cues and preserved source swatches/SVGs. The neutral dark palette was retained. Source images are neither dimmed nor inverted. Remaining production/device checks are listed in the audit report.


## Icon theme toggle

The header now uses one 44px native button with Polaris SunIcon/MoonIcon. It is a boolean Dark mode switch with a stable accessible name and `aria-checked`, reflecting the resolved theme. [Geist Toggle](https://vercel.com/geist/toggle) supports an immediately applied boolean setting with an accessible name. The visible icon replaces the words; its accessible name and action tooltip remain translatable. The theme change itself supplies immediate feedback, so no extra toast was added. Existing device defaults, persistence and storage-denied behaviour are unchanged.


## Product return page follow-up, 25 October 2026

Freshly read [Shopify’s theme design principles](https://shopify.dev/docs/storefronts/themes/best-practices/design) for responsive product information and clear actions; [Vercel’s current interface rules](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) for semantic controls, focus and resilient content; and [Geist colours](https://vercel.com/geist/colors) for role-based neutral surfaces. The source photo retains its original white background rather than inheriting the dark UI surface.

The original [Memorisely hierarchy lesson](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) was available with a transcript on this pass. Its grouping, priority and proximity principles informed separate product, saved-design and action sections. [Zander’s theme-variable post](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-figma-activity-7092391375173730304-0LPt) supports theme-variable thinking, not a prescribed palette. Existing neutral theme roles remain; the photo frame is a source-media surface.

Used the installed Checklist Design bundle’s Website Cart and Adding to cart checklists. There is no dedicated Product page checklist in that bundle. This screen is a return summary, so generic checkout, discounts, payment methods and add-ons are not requirements to invent. The actual Shopify cart handoff still needs integration design. [Independent design review](artifacts/post-cart-review/design-review.md) and [interaction review](artifacts/post-cart-review/interaction-review.md) record this scope and the evidence limits.
