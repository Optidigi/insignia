# Translation settings follow-up audit

4 November 2026. Review only. Two independent Luna Max agents examined the current workflow and responsive UI. Root reviewed their source evidence and the new 900/901 px captures. No application, stylesheet, reducer, catalog or distribution source changed in this review.

## Outcome and priority

Keep the overview/editor composition. Make a focused follow-up pass before calling responsiveness complete. Earlier desktop/390/320 approval did not cover the intermediate-width findings below.

| Priority | Finding | Evidence and recommendation |
| --- | --- | --- |
| P2 | Sidebar appears before there is enough editor width | Separate-profile captures measure the target textarea at 284 px at viewport 900, then 153 px at 901 when the 240 px rail appears. At1024 it is 214 px. Keep the compact section chooser until the editor has usable space, or reduce the rail. Validate actual editing widths rather than choosing a breakpoint from device names. |
| P2/P3 | Three comparison columns remain cramped on small tablets | Targets are 135 px at 601 and 184 px at 700. No horizontal overflow, but long translation entry wraps heavily. Stack earlier or use an intermediate composition, coordinated with the sidebar rule. |
| P3 | Search scope differs between desktop and phone | Phone Section select includes All sections; desktop sidebar omits it. No-results Clear search also silently switches to all. Add a deliberate desktop All sections choice. Clear search should retain scope; a separate Search all sections action can broaden it explicitly. |
| P3 | Active section lacks accessible current-state semantics | Native accessibility snapshot exposes buttons, with visual `data-active` only. Expose the current section through supported accessibility semantics. |
| P3 | Variable rules arrive after the author makes a mistake | References contain tokens such as `{{count}}`, but preservation guidance appears on blur/submission failure. Show concise guidance only on fields with required variables. Plural-family guidance can explain the exceptional form rows without adding repeated prose everywhere. |
| P3 | Reset action can imply the current section | Reset text is below one section, but resets all wording in the selected language. Confirmation explains this before committing. Clarify the action label, e.g. Reset all Dutch text. |
| P3 | Returning to overview loses the editing-language context | Locale selection is component state and initial state is English. Keep the authoring target across editor/overview navigation. Keep it separate from the staff UI `locale` query parameter. This is an efficiency improvement, not data loss. |
| Verify before changing | Save confirmation may be below the viewport | Success `role=status` follows the long editor and bottom actions. It is visible on short states; neither agent reproduced the offscreen case after an actual save. Verify a long section at the header Save position, then use a nearby visible status or native host toast if needed. Do not add another permanent banner speculatively. |

The recommended fix is a small responsive and workflow pass. No new screens or broad redesign are justified by these findings.

## Evidence and limits

Workflow reviewer read the reducer/workflow, storage boundary, UI, tests and existing state gallery, and navigated the supplied local preview without entering/saving text. Responsive reviewer inspected fresh isolated captures at 601/700/900/901/1024/1199 px, computed control geometry and the accessibility snapshot. The existing 1440/390/320 captures cover long text, Arabic direction/plurals, dirty work, failures, reset and loading. Root inspected the new 900/901 images directly. Temporary reviewer preview processes were stopped. No Shopify settings were changed.

No horizontal page overflow was found in the new width checks. Long-copy autosizing and Arabic target direction remain sound in the inspected images. Existing save/discard, token validation, read-only and retained-draft failure behavior remain supported by source and the prior test receipt. This turn did not rerun the full browser suite, simulate saves, exercise full keyboard traversal or independently inspect native Shopify. Those limits are not represented as passes.

Images are retained in `.artifacts/translation-settings-audit-2026-11-04/editor-{width}.png`. Source references are `MerchantTranslations.tsx`, `merchant-translations.css`, `customer-translations-state.ts` and the translation catalog. Exact measurements are reviewer observations; choosing the final layout thresholds remains implementation work.

## Checklist Design cross-check

Auditing the rendered captures and source against [Settings](https://www.checklist.design/web-app/settings) and [Saving changes](https://www.checklist.design/flows/saving-changes). Bundled checklists were read locally.

### Settings, Web app

| Status | Item | Why |
| --- | --- | --- |
| Present | Structure — Organising settings controls into logical categories e.g. account, notifications, security, billing. | Overview and editor group actual customer-copy categories. |
| Not needed here | Account details — The fields where users update their name, email address, and profile photo | Account identity is outside this translation subpage. |
| Not needed here | Security details — The ability to change the password, two-factor authentication and other security information | Shopify/account security has a different owner. |
| Not needed here | Notification preferences — Controls for which notifications the user receives and through which channel, grouped by type (product updates, reminders, billing) | This page authors customer wording. |
| Not needed here | Billing — Managing payment method, upgrading or cancelling a payment — this could also be a preview of this information with a link directly to the billing page if separate | Billing is a separate Settings destination. |
| Present | Additional preferences (if applicable) — Language, timezone, date format, and appearance settings like dark mode | Authoring language is explicit; publication and staff language are separate concerns. |
| Partial | Danger zone — Destructive actions like account deletion, clearly separated from the rest of settings | Confirmations protect reset/remove; reset scope should be clearer before opening the dialog. |

### Saving changes, Flows

| Status | Item | Why |
| --- | --- | --- |
| Present | Show action that enables change — There should be an action to enable information to be updated. It may be automatically editable, but that can be riskier for some software. If it is read-only by default, then a button can trigger the editable version to then update and save. | Target fields are editable, references read-only. |
| Present | Disable save action until changes are made — An action should be visible as a source of confirming changes to be saved - this is usually a button. Initially, the action can be disabled. It indicates no changes have been made, and there is nothing to save. A common location for this action is in the navigation above the fold, so it's always visible over the content. Another option is after all the content that's editable. | Header Save is disabled until dirty. |
| Present | State changes to active once a change is made — In the example, we've changed the email address, which means a change is waiting to be saved. Changing the button state to active brings the user's attention to the action. | Dirty state activates Save. |
| Present | Action changes to loading state when pressed — Now that the changes are being saved, you want to show that action is in progress. You can do so with a loading spinner in the action, as the user's view will be on that element. | Busy state drives the loading control; no new save was performed in this audit. |
| Partial | Notify changes have been saved — The page will reload or update, and this is the critical part. The user should now be informed that their changes have been saved. They can now safely leave the page, knowing the details are locked in until they choose to change them again. | Live success exists, but viewport visibility on long pages remains a targeted verification gap. |

W3C's [labels/instructions guidance](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html) supports necessary field-format hints without excessive prose. Its [reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) distinguishes fitting inside a viewport from retaining usable content. The measured medium-width editing constraint above is a usability finding, not a claimed WCAG failure. Current native Shopify composition evidence remains in the implementation and prior review notes; this audit does not invent new native measurements.
