# Manual variant photo assignment

27 October 2026. Owner correction: the photo-matching shortcut was safe as a manual review, but its extra flow did not earn its complexity. Its earlier independent reviews checked tidy rendering and safeguards without sufficiently challenging merchant usefulness. Matching is now removed from the local editor, examples, metadata, implementation, tests and current gallery. Earlier evidence remains historical. Draft artwork-preview and storefront-test improvements remain.

## What the flow can know

| Known fact | Reliable help |
| --- | --- |
| Current view selected by the merchant | Name it in the image-picker title. Keep every assignment in that view. |
| Actual option values and exact group membership | Show colour/fit label with variant count. Grouping stays explicit. |
| Existing assigned image and shared-image references | Mark photos in use, select the current photo when changing it, preserve choices and custom rectangles. Compact repeated references to the same view. |
| Groups with no assignment record | Offer optional Use and next in stable product order. Start the next choice blank, skip every existing choice and stop at the end. |
| User selects several groups | Use one selected image for those named groups. The picker says Same image for the targets and has no sequential Next action. |
| Image is loading or has failed | Keep Use disabled, preserve a failed current selection on Cancel, and offer Retry for that exact image. |
| Missing-image or alignment-review status | Offer local filters for large ranges, alongside group search. Select shown never silently selects filtered-out groups. |

There is no reliable source of photo orientation, photo suitability, equivalent framing or physical alignment across colours. None is inferred from filenames, colour labels, gallery position or Shopify variant associations. The merchant chooses the photo visually and reviews alignment. Known shared-image reuse remains explicit. No new onboarding guide, sample-product journey, global alignment mode or production feature was added.

## Composition and sources

Followed the saved UI delivery workflow and Shopify App Home 2.0-rc/types 2.0.0-rc.3 pin. The refreshed toolkit search confirmed native resource selection verbs and selection-scoped bulk patterns. [Resource picker semantics](https://shopify.dev/docs/api/app-home/v2.0/apis/user-interface-and-interactions/resource-picker-api), [resource-list pattern](https://shopify.dev/docs/api/app-home/v2.0-rc/patterns/compositions/resource-list), [modal](https://shopify.dev/docs/api/app-home/v2.0-rc/web-components/overlays/modal) and [content guidance](https://shopify.dev/docs/apps/design/content) govern the native controls and task labels.

Inspected the saved Teeinblue photo/label/count assignment rows and Customily source/destination mapping examples at readable scale. Reused compact thumbnail/name/count rows, explicit view/group context, native search/filter controls and persistent footer. Did not copy the reference wizard's empty space or introduce another orientation filter. Preserved the owner's 24October full-width native upload correction, supported by the saved authenticated Shopify theme-media inspection in the dialog audit. One reviewer initially suggested a compact upload tile, then withdrew it after reading that prior owner correction. Body inset now aligns to the native modal title.

Checklist Design Checkbox, Table and Uploading media supplied the selection, row, responsive and recovery lenses; current Vercel interface guidance supplied focus, meaningful labels and clipping checks. Applied relevant checklist items to actual source and captures: native labeled selection with no automatic photo choice, stable row padding/dividers, search/status filtering for large groups, direct row/bulk actions, phone stacking and visible retry recovery. Table pagination and a new sort control were not needed for this bounded local assignment list; stable product order supports continuation. A dedicated onboarding walkthrough is deferred by the owner.

## Changes

- Removed Match Shopify images and Match Front images, all matching-only fixtures/source metadata and four implementation/test files. Removed matching from the current gallery rather than leaving an obsolete route in the UI.
- Missing-photo thumbnail/name rows open Add directly. Existing-photo rows still preview the assigned photo, with explicit Change and Review actions.
- Picker title names the view; bold target label/count stays visible. Same-photo bulk consequence is explicit. Existing photo is preselected on Change.
- Use and next is optional, single-group only and commits one chosen photo. Cancel discards only the current uncommitted choice. Undo/Redo remains one image at a time. The next target gets a fresh blank selection and focus, without reopening the modal or guessing a photo.
- Assigned photo usage includes explicit group/view records and shared references. No assigned image is incorrectly called Unused.
- Failed/pending thumbnails cannot authorize a new assignment. Readiness keys include exact ID, URL and retry attempt; a late callback cannot authorize another photo. Retry keeps unrelated images independent.
- Large ranges expose All, Needs image and Check alignment filters. Applied bulk selection clears. No additional canvas band or settings page.

## Verification

The new three-width browser workflow passes at 1440×1000, 390×844 and 320×568. It covers direct Add, named target, blank next choice, selective per-colour assignment, Cancel after two commits, exact saved image IDs, untouched Back, per-image Undo/Redo, same-photo bulk with no Next, cleared selection, visible-only bulk selection, search within missing groups, long colour/fit targets and failed-current-image Retry/recovery. Public finite browser animations are awaited before captures; a reviewer caught a premature title-less capture and the corrected frame was rechecked.

Twenty-three focused domain/regression cases pass across the variant-photo model, next-target rule and image-usage helper. Picker component real-browser coverage passes for single/multiple selection, pending/failed media, isolated retry, URL changes and clearing. The existing variant-photo browser regression passes across the three widths, including alignment, regrouping, publication guards and retry. Strict admin-test TypeScript and scoped Biome pass. Web check/build passes 157 files with zero errors/warnings. Full changed editor/panel and picker validate against official Shopify 2.0-rc contracts.

Two independent Sol agents reviewed corrected source and actual desktop/390/320 frames, including long names and failure/recovery, with no remaining material findings: [design review](variant-photo-manual-design-sol-2026-10-27.md), [flow review](manual-photo-assignment-flow-sol-2026-10-27.md).

Evidence: `.artifacts/admin-popup-review-2026-10-24/manual-photo-assignment/manifest.json`, 11 states / 33 scenario PNGs. The current gallery leads with manual assignment and retains existing variant editor states for comparison. This is local frontend implementation and simulated persistence. Production Shopify integration, native host qualification, deployment and owner acceptance remain separate.

## Gallery routing correction

The owner reported missing images after delivery. The gallery HTML and filters were correct, but the preview-server screenshot allowlist omitted variant-photos, manual-photo-assignment and the flat preview-purpose folder. Reproduced HTTP404 before fixing those exact paths. A new real-server regression covers each layout, PNG bytes/content type, and rejected unknown/traversal paths. Strict admin types and scoped Biome pass. All460 linked screenshot URLs now return valid PNGs, and the existing owner gallery was refreshed and visually verified with actual desktop/phone images. This corrects the earlier insufficient gallery verification, which read the accessibility entries without checking rendered image loading.
