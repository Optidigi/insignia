# Integrated UI qualification

Use this directory for the continuing demo/live comparison, state/workflow tests and legacy-product testing on `insignia-rewrite-dev`. The canonical issue register is [issues.json](issues.json). Keep its issue IDs across turns; append observations instead of duplicating a shared failure per screen. The [previous audit](../notes/whole-product-integration-audit-2026-11-08.md) supplies the first reproductions, not a current all-green result.

## Execution order

1. Record the source commit, deployed artifact identity, store, product/configuration identity, browser, app-content viewport and locale. Distinguish deployed code from merged code. Preserve the original customer's/demonstration product data.
2. Reproduce blockers and retain redacted evidence. Fix the smallest verified cause with a failing behavior check, independent review and relevant checks. Keep source-tested, deployed and native-verified statuses separate.
3. Finish the live source catalog and data-entry recipes in [legacy inventory](legacy-inventory.json) and [import checklist](legacy-import-checklist.md). Three historical fixtures are not proof that the current complete catalog has only three products.
4. Populate the Shopify catalog by bulk import. The six verified products and 261 actual variants were imported once and reconciled in [catalog result](bulk-catalog-result.json). Reuse those destination IDs. Allocate exclusive product ownership for manual Insignia testing of views, image assignment, placements, methods and configuration. Catalog entry is preparation, not a UI test.
5. Compare the selected demo and integrated UI using the same app-content dimensions, equivalent data and state. Check screenshots plus DOM, interactions and persisted readback. Shopify's outer navigation and host-exported page actions are legitimate differences. A source-only or fixture-only result is not native proof.
6. Exercise the cases in [state coverage](state-cases.json), including normal/recovery transitions, and record pass/fail/blocked/not-applicable plus evidence. Partial preparation is not completion.
7. Have an independent reviewer challenge failures, verify fixes and check the completed product from the customer side. Consolidate the same cause once. Keep usability decisions separate from supported-behavior defects.

The detailed [parity matrix](parity-matrix.md) owns matching states and the tests needed to observe them. Native request failures need correlated provider/server evidence; a generic error message does not prove whether the cause is authentication, data shape, transport or expiry.

## Issue lifecycle

Every issue records priority, affected workflow, reproduction, expected/actual outcome, evidence level, owner, history and closure criteria. New evidence can change classification. Do not delete a finding because its next retry passes.

- `open` / `investigating`: symptom retained; cause or resolution pending.
- `fixed-local`: meaningful regression and implementation pass on the recorded source, but the live store is not yet qualified.
- `ready-for-native`: reviewed and qualified candidate exists; deployment or native replay remains.
- `verified-native`: the exact relevant deployed workflow and recovery pass. Record version and evidence.
- `blocked`: name the missing access/data/platform capability and completed independent work.
- `decision` / `not-a-defect`: retain the evidence and reason for the classification.

`verified-native` is not production approval or merchant visual acceptance. Test counts must state skips and simulation boundaries.

## Manual Insignia lanes

Before any destination write, record the exact source product, current options/variants, photo provenance, configuration and destination product ID. Use a clearly identified development copy and preserve existing products. A destination product is not fully imported until fresh UI/readback confirms the intended data after reload.

Use source-provided orientation and assignment facts. A filename, visual resemblance or color alone is not reliable orientation matching. Distinguish garment variants from decoration sizes. Preserve explicit zero prices and missing-price unavailability. Historical calibration is not a new measurement.

Keep the development store's USD/US configuration. Source EUR prices may be recorded for provenance, but copied numeric development examples are not currency conversion or commercial price parity. Record that distinction per product. Unknown data stays unknown; do not guess a manufacturing size, image orientation, variant combination or method.

Each lane reports manual steps, confusing/repeated work, control failures, layout/state differences and readback. Capture the action that caused a problem, not only the resulting screen. Agents may disagree; the primary agent filters evidence and priority.

Preserve source Superfunny data and services. The owner separately authorized setting only product `15458471575936`, Live Product Options Interactive T-Shirt, to Draft on 8 November. That one-time change was completed and freshly verified in [visibility evidence](lpo-product-visibility.md). It does not expand general source-store write permission. Use only owned development products/cart lines for other mutation tests. Reconcile an uncertain save, publish or cart attempt before retrying the same operation. This campaign creates no checkout, payment, customer email, scope/currency change or protected VAT action.

## Evidence

The first native captures are retained inside the repo at [frontend QA evidence](../evidence/frontend-qa-2026-11-08). Keep credentials, tokens, signed query strings, private logs and customer data out of this directory. Record bounded status/correlation metadata; keep necessary private operational custody outside Git.

The old dirty UI workspace remains separate. Current working branch: `codex/integrated-ui-qualification`. Documentation here does not authorize unrelated server operations or replace the repository's deployment qualification.

## Prepared catalog and photos

The native CSV import created the missing QA T-shirt and updated the five owned drafts. The import initially left all six Draft; the owner then authorized publication. All six are now Active with Online Store publication, recorded in [current catalog publication](catalog-publication-round2.json). [Catalog result](bulk-catalog-result.json) records exact readback. The development store remains USD; these copied numeric prices are test examples. Inventory is untracked on the six copies.

All 101 source view photos are staged locally in `legacy-assets/`, with hashes and source IDs in [asset manifest](legacy-view-assets.json). The binary fixtures are excluded from Git. Source assets can be staged again from a fresh public source config; retain no signed URLs. The gallery photos imported into Shopify are separate from these view photos.

## Current review reference

The approved selected demo is the primary reference. Keep new design preferences out of this parity audit. Use platform guidance only where integration adds a state absent from the demo. See [consolidated round-two findings](round2-report.md), [root observations](root-round2.md), [buyer run](buyer-round2.md) and [state review](state-integration-round2.md).
