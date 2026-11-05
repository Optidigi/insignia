# Polished merchant editor: state completeness audit

28 October 2026. Independent Luna Max review of the loopback-only placement editor in `apps/web/test/admin/support/`. This is a local preview separate from the persisted production editor. No application code, build output, shared preview state, or provider data was changed.

## Finding

### P2 · Undo silently cancels a staged movement edit while undoing an earlier product edit

**Confidence: high; reproduced in the rendered editor.** After a placement name edit, enable **Allow customers to move artwork**, open **Set movement area**, and draw a valid boundary until **Done** is enabled. Click the outer editor’s **Undo** control. The placement name remains edited, the movement option becomes unchecked, the movement task disappears, and its uncommitted boundary is lost. The only announcement is the generic “Change undone.”

The boundary lives in the workspace draft until **Done** commits it (`placement-workflow-preview.tsx:1326–1331, 1346–1361, 2821–2835`). The Undo button remains enabled whenever product history exists (`:2299–2305`). `restoreHistory` restores the earlier product snapshot and then unconditionally cancels the workspace mode (`:2096–2136`); `mode-canceled` discards every non-idle workspace state (`placement-workflow-state.mts:223–224`). The generic announcement is rendered at `placement-workflow-preview.tsx:2223–2225`.

**Minimal recommendation:** keep an active movement task and document history undo as separate actions. While the boundary is staged, Undo should resolve only that task or be unavailable until the merchant finishes or cancels it; do not silently cancel the task and also rewind the previous product edit in one click. Add a public browser regression at this real caller seam.

**Reproduction:** `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH node /tmp/insignia-polished-editor-audit-undo-20261028.mts`. The preserved temporary probe launches its own fixture preview on an ephemeral port and one Chromium instance. It captures the staged task at `/tmp/insignia-polished-editor-audit-undo-before.png` and the resulting state at `/tmp/insignia-polished-editor-audit-undo-after.png`.

## Paths checked

- First setup with no views, with no product images, and with no methods; save and reload.
- Product-only method creation/pricing, fixed-price edits, large method lists, cancel/retry, and the return to the same product/view/placement from Methods.
- Colour and Fit groups, explicit manual photo assignment, existing-image preselection, shared geometry, alignment exceptions, grouping changes, and phone layouts.
- Mixed valid/invalid uploads, rejected batches, cancel during processing, stale readiness, and failed-image retry.
- Placement drawing, movement-area setup/recovery, measurement keyboard entry, save blockers, publication blockers, staged copy review/cancel, history grouping, Undo/Redo, and return routes.

No other material user-facing gap was reproduced in these paths. The former automatic photo-matching feature is removed scope and was not treated as a missing state.

## Verification

All commands used Node 24.21.0 with the explicit project path.

- `node --test apps/web/test/admin/placement-workflow-state.test.mts apps/web/test/admin/placement-history.test.mts apps/web/test/admin/placement-publication.test.mts apps/web/test/admin/placement-photo-assignment.test.mts apps/web/test/admin/placement-variant-photos.test.mts apps/web/test/admin/placement-method-manager-state.test.mts` — 50 passed.
- Focused `placement-workflow-browser.test.mts` runs — 14 passed. Covered first use/no images/no methods, movement recovery, save/publication blockers, method assignment, multi-upload failure and cancellation, large method lists, measurement keyboard recovery, staged copy Cancel, Methods return context, and product-specific prices.
- `node --test apps/web/test/admin/placement-manual-photo-browser.test.mts` — 1 passed across 1440/390/320px.
- `node --test apps/web/test/admin/placement-variant-photos-browser.test.mts` — 1 passed across 1440/390/320px.
- `node --test apps/web/test/admin/placement-image-picker-browser.test.mts` — 1 passed for load readiness, retry, and failed preselection.
- Adversarial movement Undo probe — reproduced the finding above.

The independently run browser checks total 17 passing existing tests, plus the one reproducing probe. The current repo baseline from `frontend-workflow-followup-2026-10-28.md` remains the broader verification record; no full suite or build was rerun.

## Integration boundary and references

Correction follow-up: root made global Undo/Redo and their keyboard handler inactive during staged movement or measurement tasks. A failing-then-passing public browser regression covers desktop/390px, Done, Cancel and the committed history boundary. Independent Sol verification passes. The [consolidated correction and integrated verification record](state-completeness-audit-2026-10-28.md) owns the final result; the finding above preserves the pre-fix observation.

The polished editor and its simulated save/publication live under the test preview host; they do not prove native Shopify or production API behavior. Production method persistence, live catalog reconciliation, and Shopify publication remain outside this local editor audit.

I checked the affected configuration/publication and normalized geometry contracts in `docs/architecture/implementation-plan.md` sections 3.1–3.2, the current preview scope in `README.md`, project admin UI guidance, the Shopify Polaris App Home skill reference, and Checklist Design’s [Saving Changes](https://www.checklist.design/flows/saving-changes) and [Uploading Media](https://www.checklist.design/flows/uploading-media) flow checklists. These informed the recovery and action-state review; no new Polaris component or copy recommendation is made.
