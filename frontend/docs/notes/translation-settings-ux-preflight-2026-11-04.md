# Translation settings UX preflight

4 November 2026. Source-based proposal for the new Settings > Translations page. This is an IA and state preflight, not a review of rendered pixels or an implementation. The English-only localization foundation and current product ownership boundaries are the evidence used here.

## Scope and ownership

The page should edit text customers see in Insignia's customization experience. It should not change the merchant's Shopify Admin language. Shopify owns that language choice. Shopify also owns storefront language publication and theme-editor content. The page may edit Insignia text for a customer language that Shopify actually makes available, but it must not imply that selecting a language here publishes it to the storefront.

The current customer catalog is [`customer.json`](../../../packages/localization/src/catalogs/en/customer.json). It has text for the customizer, artwork, options, quantities, positioning, review and recovery. Some messages contain interpolation values such as `{{positionName}}` and `{{price}}`; other messages have plural forms. A merchant-editable override must preserve each message's required values and plural behavior. Do not expose catalog keys or arbitrary app strings as merchant copy. Decide which strings are safe for merchants to change; keep control and accessibility text in the app catalog unless the editor gives those fields enough context and preview.

The foundation advertises English only. This feature would add merchant-authored locale-specific overrides over the English source; it would not add a translated Insignia catalog or an automatic translation service.

Product names, options, filenames and saved descriptions remain merchant or Shopify content. The existing theme block button label is a Shopify-managed text setting, so this page should not duplicate it. There is no evidence here of an automatic translation provider or a translation-completeness denominator. Avoid copy that promises either.

Use the English catalog as the source and fallback. A missing target-language override means customers see the English source for that string. Keep that state distinct from a saved translation. If the source, target locale, or storefront availability cannot be established, show the actual unknown state instead of "Ready", "Live", or "Published".

## Recommended information architecture

Add one Settings destination named **Translations**. Give the page one short purpose sentence: it edits text customers see in Insignia's customization flow. Do not add a hero, duplicate subheading, or general explanation of localization. Shopify remains responsible for the Admin language and storefront language availability; point to its owning control only when the merchant needs to change one of those.

The overview lists the English source and the customer languages selected for editing. Keep English clearly labeled as the default source. Each target-language row has its native name, a region when needed to distinguish it, and one Edit action. Add language opens a searchable picker if the supported list is long. Show availability only when it comes from an authoritative Shopify read. Do not show a percentage, invented translation count, progress bar, or generic readiness badge.

The language editor has a Back to languages action and a single heading naming the selected language. Include one search field scoped to customer text. Search the English source and current override, not raw message-key paths. Group entries by the actual customer tasks shown in the real customizer, not by catalog file names. Each entry pairs its English source with a labeled editable value. Show only a short, specific hint when a message has required variables or plural forms. Do not put every explanation in an expandable drawer; keep the field context beside the field.

Preview the actual customer customization experience in the selected language. It should use the current draft so the merchant can see edits before saving, and show English source fallback wherever an override is absent. Keep the preview attached to the language editor and preserve the draft when it opens or closes. Do not use an unrelated sample screen or make the preview look like Shopify has published anything.

Reset each edited value to its English source. Label the action with that outcome, such as **Use default text**. If the editor also supports removing an entire language, say that its overrides will be removed and confirm that action. Do not make a destructive **Reset all** action prominent. A per-field reset can use Undo if the UI already supports it.

On desktop, keep the language list, search and source/value relationships easy to scan. At 390 and 320 CSS pixels, stack source text above its input, make text areas use the available width, and avoid a horizontally scrolling comparison table. Keep search, save, reset and preview reachable without relying on hover. Use native Polaris focus and hover treatments with real inset padding on the clickable row.

## State and reducer recommendations

| State | Expected presentation and action |
|---|---|
| Loading | Use the existing silent skeleton only when the language or message source is genuinely asynchronous. An in-memory local fixture needs no artificial wait. |
| No target languages | Keep the English source visible. Say no customer languages are selected for editing and offer **Add language**. Do not describe this as a Shopify language-publication failure. |
| Add-language picker | Show only real supported choices. Search filters locally. A no-match result has a clear way to clear the query. Selection adds an editable locale in the front end; it does not publish a Shopify language. |
| New language with no overrides | Show the English source and an empty or explicitly inherited target value. The preview uses English fallback for those strings. Do not call the locale translated or complete. |
| Search with no matches | Say no customer text matches the query and offer **Clear search**. Keep this separate from a language with no overrides. |
| Clean editor | Save is disabled or absent. Values in the editor match the reducer's committed local state. |
| Edited editor | Enable **Save changes** and **Discard changes**. Keep the selected locale's draft when the merchant opens and closes preview. On language change or route exit, ask whether to save, discard, or keep editing. |
| Local save | Commit the draft to the front-end state and update preview. A success notice may confirm that local editor state changed, but must not claim server persistence or storefront publication. Do not fake a wait or progress meter. |
| Invalid text | Validate after blur or Save, not on each keystroke. Explain the exact missing required value or plural form beside the field, focus the first invalid field on submit, and clear stale feedback as the merchant corrects it. |
| Restore default | Remove the override and show the English source in preview. Distinguish an absent override from an intentionally empty value; allow empty text only where the message contract permits it. |
| Load or save failure | Keep the draft and recovery action. Use a failure state only when the prototype models a real failing operation or an explicit review fixture; an in-memory reducer cannot have a network failure by itself. Retry must not erase edits. |
| Preview unavailable | Keep the editor usable and offer a specific retry or return action. Do not replace this with an empty-language state. |
| Narrow layout | Keep source, target field, field error and reset action in one readable vertical sequence. Verify 320px, 390px, keyboard focus, long source/target text, active hover and no horizontal overflow. |

Keep state semantic and derive display values. A small model needs the available locales, selected locale, query, source message IDs, saved overrides, draft overrides, field validation, pending local action and preview visibility. Derive dirty state, visible search results and fallback text instead of storing duplicates. Reducer events can cover language selection, query changes, value edits, field reset, discard, local save, validation and preview open/close. Keep translated prose out of state; store stable message IDs, reason codes and user-entered values.

## Checklist Design audit

The installed [Checklist Design skill](https://www.checklist.design) was applied in audit mode to the requested page shape and known contracts. The markers below describe coverage in this proposal, not a built interface. No screenshot or new page source was available, so this does not establish visual quality or working interactions.

### Settings — Web app

Source: [Settings checklist](https://www.checklist.design/web-app/settings).

| | Item | Why |
|---|---|---|
| 🟢 | **Structure** | Keep the editor under the existing Settings hub and group only language selection, editable customer text and preview. |
| ⚪ | **Account details** | Shopify owns merchant identity; this page has no profile fields. |
| ⚪ | **Security details** | Shopify owns sign-in and staff security settings. |
| ⚪ | **Notification preferences** | Translation editing has no notification channel or preference to configure. |
| ⚪ | **Billing** | Billing is a separate existing Settings destination and is unrelated to customer wording. |
| 🟡 | **Additional preferences (if applicable)** | This page owns customer-text locale overrides. Shopify owns Admin language and storefront language publication, so the label and action must keep those choices separate. |
| ⚪ | **Danger zone** | There is no account deletion here. Any remove-language action must state whether it discards overrides and confirm that consequence. |

### Empty state — Web app

Source: [Empty State checklist](https://www.checklist.design/web-app/empty-state).

| | Item | Why |
|---|---|---|
| ⚪ | **Illustration or icon** | A settings editor needs no decorative image; owner reviews rejected blank graphics and filler. |
| 🟢 | **Clear heading** | Name the actual condition: no target languages selected, no text matches, or no custom override. |
| 🟢 | **Supporting description** | Use one short line only when it explains that the customer sees the English source until an override exists. |
| 🟢 | **Primary action** | Offer **Add language** in the first-use state. Offer **Clear search** in the no-results state. |
| 🟢 | **Zero state vs. no-results state** | Keep an empty language list separate from a search miss and from an unedited locale that falls back to English. |
| 🟢 | **Error state variant** | A failed read or unavailable preview retains its own retry/recovery state instead of appearing as empty. |

### Saving changes — Flows

Source: [Saving changes checklist](https://www.checklist.design/flows/saving-changes).

| | Item | Why |
|---|---|---|
| 🟢 | **Show action that enables change** | Fields can edit inline; **Save changes** becomes the explicit commit action after a value changes. |
| 🟢 | **Disable save action until changes are made** | A clean editor has no unsaved work to commit. |
| 🟢 | **State changes to active once a change is made** | A changed draft enables Save and makes the unsaved state clear. |
| ⚪ | **Action changes to loading state when pressed** | The requested front end has no save request. Do not invent a spinner or artificial delay. Revisit if real async persistence is added. |
| 🟡 | **Notify changes have been saved** | Confirm a local reducer commit if useful, but keep the notice honest about its scope. It cannot confirm server persistence or Shopify publication. |

### Showing input error — Flows

Source: [Showing input error checklist](https://www.checklist.design/flows/showing-input-error).

| | Item | Why |
|---|---|---|
| 🟢 | **Keep the input in default state** | Do not show a validation error on first render. |
| 🟢 | **Allow user to enter information** | Let the merchant finish a phrase before checking required message values. |
| 🟢 | **Signal error after loss of focus** | Validate on blur or Save and explain the missing value or plural form beside its field. |
| 🟢 | **Return to default state upon reattempt** | Clear stale feedback while correcting, then revalidate without losing the draft. |

### Searchbar — Design system

Source: [Searchbar checklist](https://www.checklist.design/design-system/searchbar).

| | Item | Why |
|---|---|---|
| 🟢 | **Input field** | Search the selected language's customer-text entries. |
| 🟢 | **Label or placeholder text** | Name the search scope, for example **Search customer text**. |
| ⚪ | **Quick links, autocomplete and suggestions** | There is no source for suggested terms or saved searches; omit them. |
| ⚪ | **Submit search button** | Local filtering updates as the merchant types, so a duplicate submit control adds no task value. |
| ⚪ | **Previous searches** | Search history is unnecessary for this editor. |
| 🟢 | **Appropriate visibility** | Keep search beside the selected language's text list, not as global Settings search. |

## Owner feedback to carry forward

- The accepted Settings hub removes a heading that repeated a single row, the duplicate Methods shortcut, status badges without a source, global Save, routine refresh and promotional filler. Keep the new destination equally task-focused. See [Settings hub V1](settings-hub-v1-2026-10-27.md).
- The owner rejected Home refinements that added unsupported metrics, a bullet-list guide and explanatory captions. A count or completion percentage on this page needs a defined set and truthful meaning. See [Home V1 design](home-v1-design-2026-10-26.md) and [Home correction review](home-native-correction-review-2026-10-26.md).
- The owner flagged flush hover styling. A language-row link needs actual native padding and a visible keyboard-focus state, not just a hover fill on a clipped section. The Settings hub records the corrected Shopify interstitial composition.
- The privacy Settings review rejected a prominent card that led the merchant to start work in another product instead of solving the actual Insignia task. Keep Shopify-owned language publication as a precise handoff; do not make a generic warning banner or explainer card the page's main content. See [Settings clarity review](settings-clarity-sol-review-2026-10-27.md).
- If any count or amount appears, identify its source and what it counts. This feature has no price, translated-total denominator or publication proof, so it needs no amount and no progress number.
- Shopify owns components and merchant copy. Use the local [admin UI guidance](admin-ui-guidance-2026-10-20.md). The local Vercel skill supports labels, focus, inline errors, unsaved-change protection and long-content checks, but its generic title-case advice does not override Shopify's sentence-case direction.

### Implementation review correction

The first rendered implementation pass was rejected by the owner because its composition differed too much from Shopify's native layout. This preflight does not record that pass as approved. The current correction follows the native grouped overview, language sidebar and compact source/target editor structure; it still needs a fresh rendered review at desktop, 390px and 320px, including focus, hover, dirty, error, reset and narrow-content states.

## Source notes and limits

The local [Vercel Web Interface Guidelines skill](../../../.agents/skills/web-design-guidelines/SKILL.md) was present and its current primary source was read on 4 November: [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). No local Memorisely or Zander Whitehurst/Xander skill file was found. I read the original [Memorisely visual hierarchy post](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1) and [Zander Whitehurst progressive-disclosure post](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX). They support grouping related content and showing secondary detail in context. They are supplementary examples, not Shopify requirements or evidence that translation choices should be hidden.

The [local Shopify locale review](i18n-shopify-locale-luna-2026-11-02.md) distinguishes the Admin user's language from the storefront language and theme-extension strings from Insignia's customer catalog. The [localization implementation record](localization-implementation-2026-11-04.md) confirms that English is the only advertised catalog today. These notes are local evidence; the implementation owner should still check current Shopify sources and the actual reference before choosing native composition or claiming storefront language availability.

This preflight did not change application code, touch store data, open a browser session, or run a build. It read the shared customer catalog and local design/delivery notes. The implementation review should compare actual customer wording and its preview against the selected customer design, then render desktop and 390/320px states with hover, focus, dirty, validation, reset and preview interactions. This note records recommendations; it does not claim that a language list, persistence, error states or Shopify language read already exists.
