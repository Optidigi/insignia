# Localization inventory checklist lenses

3 November 2026. Auditing the current source and the English baseline captures against Checklist Design's [Typography](https://www.checklist.design/design-system/typography), [Tooltip](https://www.checklist.design/design-system/tooltip) and [Button](https://www.checklist.design/design-system/button) design-system checklists. Checklist text was read from the installed local skill, not a third-party summary. This is supporting evidence for the [step-one text inventory](localization-step1-inventory-2026-11-03.md), not a general redesign request.

Source and current captures can establish existing styles, text properties and narrow-layout behavior. Translated glyph coverage, expanded actions, tooltip interaction and text zoom need later rendered/interaction checks. The main record links the inspected source families and captures; no translation catalog exists yet.

## Typography

| Status | Item | Why |
| --- | --- | --- |
| 🟢 Present in source | **Type scale**: A defined set of font sizes with a consistent ratio between them, covering everything from captions to display headings | Native merchant text roles use Polaris's scale; customer style.css/review.css define the existing heading/body/caption sizes. This step preserves those choices rather than inventing smaller translated text. |
| 🟡 Partially present | **Semantic text styles**: Named styles that describe role rather than size so usage is driven by meaning, not pixel values e.g. display-large, body-default, label-small, caption | Polaris and the customer component classes provide roles; customer CSS also uses direct font sizes. Text ownership is mapped independently of those style rules. This is not a requirement to introduce a new styling system. |
| 🟡 Partially present | **Typeface selection and loading**: The chosen typefaces detailing style and weight e.g. Inclusive Sans Medium | Customer Inter/system fallback and native merchant type are explicit. DOM overflow helpers observe font loading. Canvas PDF uses its own system-font selection, and advertised-language glyph coverage still needs proof. |
| 🟢 Present in source | **Line height per style**: Line height defined explicitly for every text style since tightly spaced headings and readable body text require different values | Existing Polaris roles and customer styles define line-height behavior, and the reviewed English captures show distinct headings/body text. Preserve the styles and validate translated lines; source does not prove every script fits vertically. |
| 🟢 Present in source | **Letter spacing per style**: Letter spacing defined per style where needed | Native styles and customer CSS retain their existing spacing/defaults. No localization-specific tracking override is needed to squeeze expanded text into place. |
| 🟡 Partially present | **Responsive type behaviour**: How text styles respond to viewport size, whether through fluid type scaling, breakpoint-based overrides, or fixed sizes with responsive layout compensation | The layout rules and 1440/390/320 baseline captures establish current responsive compensation. Long translated labels and native component internals still need their own checks. |
| ❔ Can't tell for translated scripts | **Minimum readable size**: The smallest text size in use across the system, and how readability at that size is validated in the actual rendering environment | Current captures show the English customer/admin text at normal scale. They cannot validate non-Latin glyph legibility or output font fallback; actual target-script rendering would settle that. |
| ❔ Can't tell from this pass | **Accessibility responsiveness**: How text styles behave at 200% browser zoom, and whether any style communicates meaning through colour variation alone | No text-zoom or complete contrast/state audit was performed. Narrow widths alone are not a zoom pass. The implementation acceptance list retains zoom and visible status/action distinctions. |

## Tooltip

| Status | Item | Why |
| --- | --- | --- |
| 🟢 Present in source | **Information**: Keep content clear and concise | AdminResourceName's tooltip supplies the full clipped resource name, which is directly relevant. Generic app tooltip/action text is separately inventoried; the supplied name remains content. |
| ❔ Can't tell from closed tooltips | **Contrast**: The background should be different from the underlying content | The native tooltip was not opened in these baseline captures. A current-runtime open tooltip capture would establish contrast; source wiring cannot. |
| 🟡 Partially present | **Visibility**: How a tooltip looks and shows | Shared overflow measurement and interestFor relationships exist. The audit did not activate hover/focus/touch interactions, and AdminTruncatedLabel relies on its owning field/detail path on touch. Check each path instead of assuming one tooltip solves every context. |
| ❔ Can't tell from this pass | **Dismiss action**: Depending on how intrusive or extensive the tooltip is, a dismiss allows the user to feel more in control and allow the tooltip to feel more flexible and non-compulsory | Native dismissal behavior and Escape/focus transitions were not exercised. These concise name tooltips do not justify adding a second close control without checking supported native behavior. |

## Button

| Status | Item | Why |
| --- | --- | --- |
| 🟢 Present in current baseline | **Base style**: Your default style, one of the following: fill, outline, underline | Merchant native variants and customer primary/secondary/text actions have established styles. The inspected captures retain those distinctions. |
| 🟢 Present in current baseline | **Shape**: Visual properties of a button: padding, border, border radius, shadow | Existing shapes/insets are visible in the representative captures. Preserve those shapes when allowing translated labels to wrap or groups to stack. |
| 🟢 Present in current baseline | **Variants**: Each visual type to represent button structure e.g. primary and secondary buttons | Current merchant/customer variants are present and mapped. Localization does not require new button variants. |
| 🟡 Partially present | **Copy**: Instructional text that details what will happen if you click the button | Existing actions and hidden accessible names are inventoried. Fragment assembly such as View all plus a noun needs contextual whole-message keys. No target-language wording is approved yet. |
| 🟡 Partially present | **States**: How the button changes based on the interaction: hover, focused, disabled | State sources and pending/disabled copy are covered in the source audits. The screenshots show only current resting examples; translated hover/focus/disabled/pending fit and focus recovery need later interaction checks. |

These statuses describe the evidence available for this inventory. They do not certify accessibility, native Shopify behavior or translated layouts, and they do not turn every untested item into a request for a new UI element.
