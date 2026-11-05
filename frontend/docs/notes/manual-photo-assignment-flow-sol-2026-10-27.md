# Independent manual photo-assignment review

27 October 2026. Owner replaced the matching direction with simpler manual assignment. This note supersedes the matching recommendation in the earlier preview-and-matching review. Independent source and rendered review completed for the revised manual workflow. No material correction remains in the reviewed states. No app source was edited by this reviewer.

## Current workflow findings

Few colours already have a direct Add or Change action. Keep that route short. Checkboxes are useful when several groups intentionally reuse one photo, but the picker should make clear that one selected photo is applied to every selected group. A merchant assigning distinct photos needs another route; selecting many groups and assigning one image does not solve that task.

For many groups, a deterministic next-unassigned action can avoid repeatedly closing the picker, finding the next row and opening it. Keep the ordinary one-off Assign action. An optional Assign and next action must name the current group and view, skip assigned groups, follow a stable order, stop at the end and leave previous assignments unchanged. It must never infer colour or front/back from filenames. Cancellation must preserve assignments already explicitly applied and leave the current pending choice unapplied.

The picker currently derives Used in and Unused only from shared view image URLs. A photo assigned to Black on Front can therefore be called Unused. Derive usage from real shared views and explicit group assignments. This is useful factual assistance and avoids hiding a reused image under the wrong filter. Keep full target scope accessible for long fit/material combinations.

A local Needs image filter can reduce search and scrolling across a large catalogue. Show its active state and removal route. Selection must have an honest total when search hides selected groups; no filtered action may silently target the hidden catalogue. Keep missing-image work separate from alignment checks.

Existing panel Retry and Change actions offer recovery from a broken assigned URL. The picker currently shows Preview unavailable but still allows that photo to be selected and assigned. Prefer disabling a new uninspectable choice and offering retry or another image. Cancelling must preserve the existing broken assignment rather than clearing it automatically.

Shared-image choices remain explicit and scoped to the current view. Existing custom placement rectangles must survive photo reassignment and shared-image choices. New photos still require visual alignment review; a faster assignment flow must not confirm alignment. Independent views need independent manual assignments. Fit/material options only group appearance; they do not add variant-specific manufacturing rules.

## Review lenses

Read the saved UI workflow, admin guidance and prior persona audit in the preceding review. Re-read the active panel, picker, parent dialog and model. Applied Shopify App Home/content guidance, Checklist Design filtering and saving checks, and Vercel focus/forms/navigation checks. The owner explicitly deferred onboarding examples and guides; this review makes no recommendation to add or repair those now.

## Revised implementation and actual pixels

Reviewed `placement-photo-assignment.mts`, `placement-image-usage.mts`, the panel, picker and parent dialog. Matching is removed. Use and next advances through later unassigned groups in stable product order within the current view. It skips every existing assignment record, including explicit shared choices and alignment-only exceptions. It does not guess colour or side. A new current target receives no carried image selection. Existing bulk actions apply one explicitly selected image to the named groups.

Usage now derives from shared view references and actual group assignments. The compact label prioritizes explicit group/view use, so a photo in Black · Front no longer says Unused. Long usage remains available through the existing truncated-label disclosure. Needs image and Check alignment filters apply to large lists and retain search, active counts and Select shown. Existing selected-group totals remain visible and the picker confirms the complete target scope.

Reviewed actual desktop, 390 px and 320 px panel, initial picker, selected picker, next target, applied result, bulk reuse, Needs image filter and search captures. Also reviewed the long combined colour/fit target and failed/recovered current-image picker states at all three widths. Evidence is in `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/manual-photo-assignment/{desktop,mobile,narrow}`.

The current group is bold, the dialog title names Front, and Use and next changes the target to White with no image selected. The normal Use image action remains available for a one-off assignment. Bulk says Same image for Black, White and Use for 2 groups; it has no next action. At 320 px, the three single-assignment footer buttons fit without horizontal clipping. The long Navy / Relaxed unisex fit target wraps within the dialog. The large-list filter shows Needs image with its count; a query reduces the list to the intended group without changing that filter. Newly assigned rows still display Check alignment and retain Review/Change. Missing Navy stays Image needed.

A failed current photo stays selected, preserves Cancel, and disables Use image. The image tile offers Retry; after loading, the selected photo becomes inspectable and Use image becomes enabled. This fixes the earlier source finding without dropping existing assignments. The narrow modal requires scrolling through its upload/gallery content, as before; keyboard focus must reveal Retry rather than leave it beneath the footer. The refreshed 320 px failed-photo capture shows the complete failed tile and Retry above the fixed footer, with Cancel available and Use image disabled. No clipping or covered recovery control remains in that state.

## Scope and verdict

The revised flow improves repeated manual work with deterministic assistance. It needs no matching step, guessed side/colour, new global settings or onboarding guide. The existing shared-image choice and per-photo alignment exceptions remain the right model. Colour/fit pixels establish a combined appearance target; material follows the same generic option model in source, not a separately rendered material fixture. Neither establishes variant-specific production eligibility.

Root reports passing three-width workflow checks, failed-image retry, two explicit Use and next commits followed by cancellation of only the pending Navy choice, Back preservation, per-assignment Undo/Redo, bulk assignment and cleared selection, filtered selection of only the missing groups, relevant model and variant regression checks, and pinned Polaris 2.0 RC component validation. This reviewer inspected source and saved pixels independently but did not rerun those tests or operate shared browser tabs. Static captures cannot establish keyboard behavior or native Shopify checkout. Backend integration and owner acceptance remain separate.
