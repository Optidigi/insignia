# Customer customizer flow recheck

29 October 2026. Independent source, browser-state and rendered review of the selected sibling `../designer-prototype`. Local only. No Shopify writes, backend wiring, deployment or owner acceptance.

## Boundary and evidence

Insignia is the customizer modal opened by Shopify's Personalise action. Shopify owns the product page, cart and checkout. The sibling's labelled `/product` route is a developer host stand-in used here only to verify handoff, focus and reopening. It is not a customer design reference. `apps/storefront` was not used as the selected design.

Read `AGENTS.md`, the saved UI delivery workflow, the latest customer-handoff note and implementation-plan sections 8.1, 8.2 and 8.4. Checklist Design's Modal, Loading, Uploading media, Saving changes and Showing input error references supplied interaction checks. The current [Vercel interface guidance](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) supplied the focus, accessible controls, asynchronous feedback and long-content checks. Source rules did not substitute for actual rendered inspection.

Used Node 24.21.0 and an isolated Vite at `http://127.0.0.1:56347`. The user's 5173 preview and browser session were untouched. Fresh contexts covered classic and long-content at 1440, 390 and 320 px in light and dark themes. There are 36 artwork, sizes and review captures, 12 artwork-dialog captures, two initial probe images and 18 corrected-state captures. No document overflow or uncaught browser errors occurred in the completed initial matrices; the final correction check also had no uncaught errors.

Durable evidence is in `/Users/pc/Development/Insignia/.artifacts/customer-flow-recheck-2026-10-29/`. `receipt.json` records the first matrix, `modal-flow-receipt.json` records the interaction matrix, `final-spotcheck-receipt.json` records the corrected-state check, and the scripts retain the exact controls and actions. Developer-host outcomes are recorded as simulated facts only.

## Findings sent for correction

### P2: picker searches waited for blur

At `/?scenario=large-palette&example=accordion`, 390 px, opened Choose colour and entered `zzzz` in Search colours. While the search field stayed focused, all 60 colour buttons remained visible, no empty result appeared and the clear-search action was absent. Tab caused the results to change to zero. The same native-event mistake affected Search positions in `many-placements`.

The shared text field used native Preact `onChange`. A search needs the input event to update as text is entered. This was not covered by helpers that blurred fields after filling them. `search-before-blur.png` shows the visible mismatch. The new public browser regression exercises filtering, an empty result, clearing and focus without blur in both pickers. Both subtests failed before the implementation correction. See `picker-search-red.log`.

### P2: quantity counts, totals and validation waited for blur

At `/?scenario=classic&example=accordion`, 390 px, opened Sizes & quantities and entered 2 in a quantity field. While focused, the footer still said Per item and EUR 32.45, and the colour header showed no quantity. Tab changed the footer to 2 items and EUR 64.90. The quantity input used the same native change-event pattern.

The new regression requires the displayed total to follow typing while focus remains in the field. It also covers fractional and over-limit input remaining editable with an error, clearing the field and entering a valid replacement. The initial assertion failed against the original handler. See `quantity-red.log`.

### P3: Edit quantities removed the focused control without selecting its destination

From Review, Edit quantities changed the step but left `document.activeElement` as BODY. This occurred in all 12 layout/theme combinations. The next Tab did reach the first quantity field, so this was a bounded focus improvement rather than a navigation dead end. Edit artwork already focused its editing destination explicitly.

At the coordinating agent's request, added a separate regression requiring Edit quantities to focus the first enabled quantity field. Its initial run with the corrected wait signature failed on that focus expectation. See `quantity-focus-red.log`. This reviewer changed only the expressly delegated browser-test file and this note, not customer UI source.

## Corrected-state result

The coordinating agent changed the shared search field and the native quantity input to `onInput`, preserving `onChange` for native selects and file inputs. Edit quantities now selects the quantities step, then focuses the first enabled quantity field and scrolls it into view. The candidate log at `/Users/pc/Development/Insignia/.artifacts/frontend-recheck-2026-10-29/customer-candidate.log` records 19 passing customer tests, zero failures and zero skips. The coordinating agent also reported the selected build passing.

After those changes were frozen, this reviewer used fresh browser contexts to recheck all three widths in both themes. Search results changed while the field remained focused; colour and position searches showed an empty result and cleared back to all choices without losing focus. Quantities updated the count and total before blur. Fractional and over-limit values stayed editable with their error, clearing removed the error, and a valid replacement recovered normally. Edit quantities focused the first enabled field. Accepted add still closed to the labelled simulated host result, and unchanged Done closed without another completion. The six final combinations passed with no browser errors and produced 18 new captures. There are no remaining material findings from this recheck.

## Exercised behavior

The first matrix completed accepted add, unchanged saved-design Done and changed-quantity update in every layout/theme combination. Accepted operations closed the customizer. Update retained one saved design identity. Done produced no new completion. Reopening cleared old completion, and Personalise after a clean close started an empty design.

Each interaction-matrix combination also exercised:

- Artwork dialog Escape restored its exact opener and left the customizer open. A desktop backdrop click closed only that dialog.
- A text file produced the format error. An unreadable PNG produced the decode error. A valid SVG with a long filename then applied successfully and closed the dialog.
- Adding a second colour, entering three items, removing that colour and choosing Undo restored its quantity.
- Closing the customizer restored the host trigger's focus. Personalise resumed the unfinished quantities. Browser Back and Forward retained both colour rows and their quantities.

Source review also checked generation-guarded upload cancellation, removal recovery expiry, saved-design switch confirmation, unchanged-edit detection and completion clearing. Those observations are source evidence; this recheck does not claim to have independently rerun every preexisting stale-upload or unload test.

## Checklist review

### [Modal](https://www.checklist.design/design-system/modal)

| | Item | Evidence |
|---|---|---|
| Present | Title. Clear, simple text explaining the action of the modal | Artwork dialogs name the placement. |
| Present | Actionable item. A button or link to continue or close the event | Browse, sample choices, artwork-later and Close have distinct outcomes. |
| Present | Close action. A way to exit the modal | Close, Escape and desktop backdrop dismissal worked. |
| Present | Responsiveness. Consider the size of the modal on different device sizes, and whether a modal is suitable on all | Actual captures at 1440, 390 and 320 fit; scrolling preserves access to content. |
| Present | Background change behind modal. Darken, blur or lighten - change the background behind the modal to bring focus to it | The native dialog backdrop dims the customizer. |
| Present | Description. Incase they require more information to understand how to make their decision | File constraints are visible before selection; errors name the recovery action. |

### [Loading](https://www.checklist.design/design-system/loading)

| | Item | Evidence |
|---|---|---|
| Present | Visual indicator. A clear representation that content is loading or in progress of change | Pending local decode changes the upload prompt and disables Browse. |
| Present | Text. Explaining the loading state | The source renders Opening file during local file reading. |
| Present | Time. Determine how long the time between two actions must be to require a loading component | Local add/update is immediate; this preview does not manufacture a remote-cart loading period. |
| Present | Accessibility. Ensure your loading state can be clearly seen | Upload text remains in the visible upload container in both themes. |
| Not needed here | Visuals. Entertain the user with an illustration during the loading state | A short local file read does not justify an additional loading illustration. |

### [Uploading media](https://www.checklist.design/flows/uploading-media)

| | Item | Evidence |
|---|---|---|
| Present | Empty state. Show a clear visual placeholder with an upload icon and simple text that indicate a file can be dropped into the area to upload. It's also suitable to offer a click to upload route incase a user prefers that option. | The drop zone and Browse route are visible in the fresh dialog captures. |
| Present | Drag and drop interaction. When a file is across the interaction canvas, there should be a clear visual state change to indicate it has detected a file attempting to be dropped. This lets the user know it's safe to release the file at this point. | Source applies the dragging class on drag-over and clears it on exit/drop; this was source-inspected, not separately pixel-captured during dragging. |
| Present | Progress indicator. Display progress that updates in real-time so users know their upload is working. If a percentage is not possible to show, a loading indicator can at least show that something is happening. Include file names and show overall progress when uploading multiple files to keep users informed throughout the process. | This single-file local reader shows Opening file. There is no claimed remote upload percentage. |
| Present | File restrictions & constraints. Clearly state limits to what files can be uploaded. This is commonly file size and format, shown in the upload area before users attempt to upload files. If a user tries to upload a file outside the constraints, an error message should show explaining it does follow the constraints. | PNG/JPG/SVG and 5 MB are visible. Wrong format and decode error were exercised; the size bound was source-inspected. |
| Present | Outcome status. Use visual indicators like green checkmarks for successful uploads and red warning icons for failures. For failures, include an error message explaining what went wrong and what users can do to fix it. | Errors appear as alerts with a replacement-file instruction. Successful decode applies the artwork visibly. |
| Present | Upload actions. Ways to interact with an upload. Choose which actions to show by default vs on hover based on available space, aiming to avoid overwhelming users with too many visible options. Common actions include: Retry failed uploads Cancel upload in progress Delete files Rename files | Another file can recover from failure; closing cancels the pending generation; placement removal supplies Undo. Library rename/delete is not needed to complete this selected placement flow. |
| Present | Showing multiple uploaded files. Display files in a clean list or grid with thumbnails when possible, and ensure the layout you choose is scalable. What information you show about each file depends on the context of the upload. A file name or size can be relevant in one case, while seeing the images uploaded can be the relevant detail in another. | Files use thumbnails and retained accessible names, with full-name disclosure for truncated library entries. |

## Limits

These are disconnected-preview findings. They do not establish successful Shopify cart writes, universal theme-drawer behavior, checkout qualification or production readiness. The selected UI still needs the real adapter's bootstrap, authorization/application busy, rejection and uncertain-result recovery states. Keep it open until the actual cart outcome is verified, then restore focus to Shopify's owning Personalise/Edit trigger. No extra Insignia product-return or cart page is called for.
