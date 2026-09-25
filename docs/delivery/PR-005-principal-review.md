# Principal review — Insignia PR #5

Date: 25 September 2026. Principal: ChatGPT, Insignia Rewrite Project.

## Verdict and binding

**APPROVED — diagnostic, guard and evidence checkpoint only.**

- Repository: `Optidigi/insignia` (ID `1386102402`); PR `#5`.
- Base and effective merge base: `895aef65179267a9944c57c40478eeb704a8b65a`.
- Reviewed head: `afce3b668240d3a6b87741c173d1be0547ef4821`.
- Live PR at review: open, unmerged, mergeable; two commits and 34 changed files.

No merge-blocking defect found in the inspected scoped changes. This is not acceptance of a native fulfillment outcome, completion of G1, permission to change architecture, or delegation of merge/staging authority. A normal merge needs the owner's explicit delegation. Keep the reviewed head unchanged until then.

Native APPROVE submission for this head returned HTTP 403, `Resource not accessible by integration`; no native approval was posted. This document and the principal's chat verdict are the attributed external review. Do not impersonate a reviewer or bypass protections.

## Evidence inspected and limits

Reviewed PR metadata, fixed-ref comparison and changed-file inventory; the full form guard, both unit-test files, manifest verifier, M0-003 receipt checker, CI check-script delta, capability report, receipt index, protected fulfillment read, review packet and AGENTS routing. The guard deliberately returns `submissionAuthorized:false`; its historical fixture includes synthesized control fields and is correctly described as a regression input, not a recovered browser request.

Read the actual Actions logs for run `36079496495`, job `107898044938`, associated with this head. Checkout was GitHub's synthetic merge `ad27d3ab39bde7f88936c4ea61dc890604b45108`, whose logged message identifies the reviewed head and base. Logs show two native Rust tests, eleven Wasm fixtures, seven Python tests, and manifest checks for 44 historical and 16 new evidence files passing. The inspected fail-fast script also runs both receipt checkers; their detailed stdout is suppressed. This is CI evidence, not a principal-local rerun or a staging test.

Locally calculated SHA-256 and Git blob identities for the supplied plan/ledger and matched the published blob identities at this head. Both records are unchanged; details are in `PR-005-verification.json`. The Function source/schema and app config are not changed by this PR.

The principal did not run Shopify/browser operations, rerun the complete suite on the server, or independently recalculate every committed receipt hash. An attempted public archive download in this runtime failed on DNS resolution; code inspection used the GitHub connector. The reported preserved baseline is supported by retained API responses and passing CI consistency assertions, not a new principal-controlled live-store read.

## Accepted observations

The exposed shared-browser tools do not provide the required native request-body interception path. The capability probe does not prove that all browser tools lack network inspection. M0-003 correctly stopped under its issued instruction before new control/candidate orders. Order #1001 and its existing fulfillment are preserved. No new merchant-lifecycle evidence was produced.

The guard and manifest checks are useful local tooling. They are not a calibrated live-native-form adapter or a production authorization component. Native checkbox and quantity behavior must be observed before applying the synthetic input schema to a real form; unknown or contradictory data cannot be filled with desired values.

Historical outcome: intended one unit, recorded two-unit fulfillment. Historical cause: **UNDETERMINED**. G1 stays **IN_PROGRESS**. G2–G8 and M1 remain outside this review's authorization.

## Principal correction to the diagnostic method

I made actual native request-body capture an unconditional prerequisite in M0-003. That was too restrictive for the next bounded merchant-workflow acceptance experiment. Request capture is useful for attributing a defect to client versus server processing, but correct supported native interaction plus direct resulting order/fulfillment/inventory evidence can establish the observed workflow outcome without it.

`M0-003R-native-outcome-continuation.md` therefore supersedes the unconditional capture/abort prerequisite. It does not lower the required business outcome: the exact intended real line and quantity must be fulfilled, other lines must remain unchanged, and monetary/inventory behavior must reconcile. It does not prove what an uncaptured internal request contained or explain the old incident. Retain that distinction in all conclusions.

No new browser framework, private Admin API reverse engineering, session copying, fetch/XHR monkeypatch, broad HAR, or invented request is required or authorized. Prefer existing supported tools. A mismatch or ambiguous live mapping still blocks dependent mutations.

The next work is the previously unexecuted C/R comparison, followed only on success by the existing conditional lifecycle cases. Preserve #1001; retain the same maximum of three new Bogus orders/thirteen purchased units and no new stock seed. Receipt-only work must not be described as additional product progress.

## Next checkpoint

Owner-authorized normal merge of this exact PR -> continuation branch from actual remote main -> M0-003R -> one outcome/evidence PR -> principal review. The companion launch text is for the owner to send as an explicit instruction, not a grant inferred from an attachment.

## References

- Reviewed PR: https://github.com/Optidigi/insignia/pull/5
- Evidence: https://github.com/Optidigi/insignia/blob/afce3b668240d3a6b87741c173d1be0547ef4821/spikes/m0-001/evidence/m0-003/README.md
- Capability report: https://github.com/Optidigi/insignia/blob/afce3b668240d3a6b87741c173d1be0547ef4821/spikes/m0-001/evidence/m0-003/capture-capability.json
- CI: https://github.com/Optidigi/insignia/actions/runs/36079496495
- Native partial fulfillment: https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/single-fulfillment
- Optional network-observation capability, not evidence of access to the shared tab: https://playwright.dev/docs/network
