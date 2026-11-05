---
name: insignia-ui-delivery
description: Build or substantially refine Insignia merchant screens and flows with source-grounded states, rendered correction passes, and independent review. Use for new screens or changes spanning layout, copy, and interaction; keep small isolated edits proportionate.
---

# Insignia UI delivery

Use the process that produced Home V1's clean first owner review. Preserve the user's chosen scope and design direction. This is a delivery workflow, not a fixed Home layout or an approval gate.

## Establish the design before coding

1. Read the current [admin UI guidance](../../../docs/delivery/notes/admin-ui-guidance-2026-10-20.md), affected product contracts, and closest owner-reviewed screens. Use the installed Shopify skill and the runtime/type pins actually selected by the project. Shopify governs native components and merchant copy; Checklist Design and the named supplementary sources supply review lenses.
2. Inspect the actual reference composition before choosing an implementation. Open its screenshot at a readable scale and inspect the rendered DOM or public example where available. Record its hierarchy, density, label treatment, value/chart layout, progress controls and expanded state, then name which of those details the proposed screen follows. A source URL or general pattern description alone does not establish visual similarity. Record what each example changes in the design decision. Distinguish a live observation, a documented behavior, a published example, and an inference. A catalog of app names or marketing images is not evidence of their current layouts.
3. Define the screen's facts and states: source, actor, time scope, next action, owning destination, loading, absence, restricted access, failure and recovery. Separate facts that can coexist. Product publication, theme status, customer acknowledgment and work completion are different facts. For a frontend-only assignment, model intended states explicitly without expanding backend scope.

Start implementation when the main hierarchy, action destinations and state distinctions are concrete enough to test. Keep necessary task guidance visible; disclose secondary detail according to context. Use real assets when they teach the task, rather than adding imagery to fill space.

## Build and inspect the actual result

4. Reuse production presentation in explicit local scenarios. Keep fixture controls and implementation explanations outside merchant copy. Preserve the owning resource for editing, bulk work, consent and detailed recovery. Give each prominent action a truthful label and destination.
5. Render representative desktop and phone states before asking a reviewer to judge them. The current gallery baseline is 1440, 390 and 320 px; choose additional widths only for a real layout concern. Inspect normal, first-use, long-content, loading, restricted and failure states that the change affects. Check actual text insets, glyphs, line boxes, action alignment and visible destinations. Type validation cannot establish these.
6. For substantial UI work, use independent source/state review and an actual pixel review once captures exist. Give the reviewer the reference images as well as the implementation images and require a direct composition comparison at comparable scales. A review that confirms controls exist, counts are truthful and padding is intact has not yet checked whether the requested design pattern was implemented. Give reviewers the relevant source and real image paths. Ask for concrete findings against the sources and the user's prior feedback, rather than a predicted approval. One reviewer can cover both lenses; source-only review cannot approve appearance.
7. Correct material findings, render again and recheck affected states. Exercise changed links, keyboard interaction, dismissal/persistence and asynchronous recovery, including where focus lands after content disappears. Run relevant types/build/style and the pinned Shopify validator. Passing checks need repeating only after a relevant change or unresolved failure.

## Keep summaries and handoff truthful

Metrics need a definition, period and complete source. Keep data rules in the model and put secondary metric definitions in contextual help, as the reference does. A truthful data rule does not automatically belong as visible explanatory copy. A page of records is not a global total. Recent work needs a familiar recency label and an obvious route to all records; express limits through the reference’s established controls or count treatment rather than adding implementation-limit prose. Pending work must remain independently discoverable. Dismissing guidance is not completing its tasks, and ordinary guidance dismissal must not hide current work or failures.

Refresh the review gallery from corrected captures, lead with the changed screens, and retain other current states for comparison. Report local implementation, simulated behavior, native observation, owner feedback and deployment separately. Owner praise for a clean V1 records that local quality; it does not establish release approval or make that layout mandatory elsewhere.

When diagnosing native composition quirks or preparing the pixel pass, use [observed failure examples](references/observed-failures.md). They explain the mechanisms that escaped initial checks and link to the evidence.

## Apply owner corrections to the process

The owner accepted the cleanliness of Home V1, then rejected the first refinement's plain metrics, bullet-list guide and explanatory captions. Preserve the first result's care without treating its sparse composition as a permanent style. For statistics, inspect the native value/chart relationship, shared-band framing and contextual definitions. Choose the few metrics that answer a merchant question; a chart on every available fact is not a design goal. Review proven no-order stages separately from established shops with a zero period, and let the next setup action lead before there is activity. For getting started, inspect the task-completion controls, progress and expanded step. Use those mechanisms when that is the requested pattern. Record backend data limitations in delivery notes while designing the intended UI states explicitly within the frontend assignment.
