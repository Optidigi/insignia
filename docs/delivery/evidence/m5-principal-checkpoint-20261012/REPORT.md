# Insignia M5 — owner-requested principal checkpoint

12 October 2026. **M5 IN_PROGRESS / G7 NOT_PASSED.** This packet closes the current Function/readiness slice and pauses execution for the owner's requested review. It requests review of the unfinished milestone, not acceptance of M5 or permission to start M6.

## The purpose and current shape

The intended first version is a merchant admin that can configure a product, show a visual preview, save a durable draft, reject stale edits, request publication, activate an immutable revision and show the actual effective revision. Signing is internal infrastructure; merchants should not manage keys or technical setup. The original scope is [implementation plan M5](../../../architecture/implementation-plan.md) and [finish plan](../m5-admin-presentation-readiness/M5-FINISH-PLAN.md).

The rewrite remains a modular monolith: pure domain/application, Shopify adapter, PostgreSQL18/pg-boss durable state, Astro7 SSR/Preact/Polaris admin, framework-independent Konva visualizer and Rust Functions. Existing TypeScript boundaries, exact money, whole-quote v2, immutable revisions, tenant/install generation fences and availability v1/v2/v3 meanings remain locked. New activation uses v3; v1/v2 remain historical compatibility/recovery paths. No architecture reset is proposed.

## What is now verified

- Owner normal-browser observations prove the picker loads, Search returns products, Polaris styling is present, technical signing buttons are gone, and Check readiness returns “Readiness checked. Publication still requires current eligibility.” These are owner observations, not agent browser recordings or proof of publication eligibility.
- PR88's SDK scope correction is merged and its exact qualified web image is deployed. Write grants imply their corresponding read grants; raw OAuth/current-installation observations remain distinct. Both Function-write grants were independently verified. No additional consent or release is presently identified as necessary.
- PR89's private input component is merged. Its actual CI image control exercised the pinned SDK verifier, private pipe and HTTP boundary. A first input transport stopped without initializing native setup; its exact cause was not captured. Cleanup was independently reconciled. A separately qualified fresh transport received the owner identity, removed its temporary route/container, and invoked the existing production Function setup once.
- **FUNCTIONS_VERIFIED:** one transform creation and one validation creation were acknowledged; the final ownership read and closing authority checks passed. All 16 recorded semantic operations settled ACK. This is actual native evidence. SDK internal HTTP counts are not asserted as those 16 operations.
- Two distinct fresh trusted-release collections each appended an immutable record through the existing restricted release-append role. Both returned ACK, no ambiguous write. Native evidence binds the exact Active version/modules, current tenant/install generation and owned Function instances. This proves collection/append works; an expired record is not current authority.
- Final read-only reconciliation shows zero temporary input containers, no local owned input/collector/tunnel processes, no signing attempt and healthy unchanged web/worker/database. [Receipts](native-final-reconciliation.json), [Function settlement](function-settlement-summary.json), [first append](trusted-release-first-receipt.json), [signing refresh](trusted-release-signing-refresh-receipt.json).

## What is blocking M5 now

**Immediate blocker: signing preparation and its verification coordination remain unqualified.** The signing plan and private persistent storage exist; its attempt directory is absent. The owner ran a bounded status-wait command, but the fresh record had already aged beyond the unchanged 30-second requirement before the browser action. No setup POST/native signing attempt was observed. The owner only reported a pending Promise; its final browser value is not supplied. Never relabel that as success or an ambiguous signing mutation.

The orchestrator started the refresh too early and incorrectly suggested that bounded polling eliminated the timing issue. It did not. This is a coordination/integration failure, not evidence of a new missing scope, secret, tenant or Function defect. Manual Console actions plus transient root-operated verification do not yet make a reliable merchant workflow. The server correctly failed closed. The 30-second contract was not relaxed.

**Remaining acceptance work:** server-owned signing/public-config settlement; current trusted merchant timezone/day and actual owner-backed development eligibility; one disposable product/ProductConfig merchant flow; native G7 rows; allocated-store genuine uninstall/privacy qualification; fixture cleanup; test-footprint ceiling; cumulative Spec/security and plan-drift review. [Acceptance map](ACCEPTANCE.md).

## Why the run became expensive

Real defects were found and corrected: generic auth failures, route mismatch, missing styling/technical setup UX, canonical scope semantics and process cleanup boundaries. Some tests protected the wrong integration assumption until the actual production seam was exercised. Historical qualification helpers and repeated freeze/review/build cycles accumulated. The recent root-owned private wrappers required corrections for stale transport admission, detached children and dependency qualification. Those changes prevent interrupted external writes from continuing invisibly; they do not add merchant features.

The wrappers ultimately passed independent review and real OS controls, but this is not evidence that the overall delivery overhead is proportionate or that M5 is close enough to waive its remaining criteria. The next plan should reduce orchestration machinery and manual timing, not add more report-only slices or duplicate tests. Preserve genuine failure, generation, privacy and protocol controls.

## Commercial configuration and resources

Owner terms: one all-released-features paid plan, USD49.99 per30-day cycle, 100 qualifying paid customized orders included, then USD0.10/order; 14-day live trial waives subscription/order fees. The owner explicitly allocated the existing zero-cost development subscription on insignia-rewrite-dev for current M5 features and allowance. This does not invent production subscription state, Partner credentials, plan/policy identifiers or authorize billing/checkout work. Actual current eligibility still needs native qualification. [Owner terms](../../authority/commercial-single-plan-2026-10-10.md).

The protected designated installation is insignia-rewrite-dev.myshopify.com; it is not disposable for uninstall. The separately allocated store is stitchs-vat-verification-20261004.myshopify.com. Its earlier owner observation was Insignia absent; that is historical, not a current native safety gate. Existing owner VPS access/resources are available within scope. Legacy Insignia/Stitchs/Superfunny changes and merchant rollout remain excluded.

The controllable T3 browser still reaches Shopify login. It does not provide the owner's normal authenticated session. The user performs native browser actions; credentials/session cookies are not copied into chat or substituted for staff authority. No human-verification bypass is used.

## Conventions and complexity

[Conventions](CONVENTIONS.md) records the owner changes and implementation consequences. The latest comparable tracked inventory has implementation27,940, operational9,200 and test42,525 nonblank lines: **53.38%** test share, above50%, with5,385 test lines above the present implementation+operational total. Private one-shot qualification drivers are disclosed separately and excluded from this tracked measurement; it is not a complete workspace count or a budget pass. [Measurement](footprint-current.json), [path classifications](footprint-paths.json).

Measured earlier improvements include browser-lifecycle consolidation (220 nonblank test lines removed with the meaningful assertions/routes retained) and removal of the duplicate operator invocation from foundation CI. The ceiling remains unmet. No source padding, path relabeling, hidden private helpers or necessary-assertion deletion earns completion.

## Exact source, build and version identities

Integrated entry for this report: main0706dea3042a6f6e63fa24ea144bea1a730394d7, tree3491cb6e3d95e76eae69159af8f93a0a0acf7d8e. PR89 merge parents are11f3318133abf1fd1e1931d18238dd9896487581 and279d82a162fcd86bc61d2fc01dc8c570c1684776. PR88/89 exact-head natural CI and independent review receipts are listed in [qualification](QUALIFICATION.md). The report candidate's own head/tree and CI are recorded separately in its PR/packaging receipt; do not attach prior runtime results to a changed build.

Deployed web comes from PR88's qualified tree31cce31219128c0c83e8209069485ebf6fc5d586. Image OCI manifestfac25c11e5dc85074209f3d214a3159062d51139ed78da6571598488e34648fd; CI config image IDc1d351f6b33a3f08f8a9c6f9905da50eda68fa9043d4c710327c2c9b6236a5a6. The complete content/identity mapping was verified. Original import STOP remains; its exact cause was not captured and is not invented. One separately qualified web recreation settled; database/worker/environment values/mounts stayed unchanged.

Canonical app Insignia, origin https://insignia-app.optidigi.nl, App Home /admin/products. Active1163229200385 / m5-functions-9c2e56b42fbf; previous1162611916801 retained inactive rollback;1158837927937 / m5-019-a9717e1265ef remains inactive/NEVER_RELEASE. Required scopes empty; configured optional seven include the accepted product/publication and Function read/write scopes. API2026-07, exact reviewed Function artifacts remain. No version creation/release, deployment or merchant fixture happened during this closing checkpoint.

## Recommended principal decision

Review this as a **bounded unfinished-M5 checkpoint**, not M5 PASS. Confirm a concrete completion design for fresh trusted release evidence and internal signing that avoids human timing while preserving current authority/freshness contracts. Do not approve another sequence of near-identical planning wrappers as the completion strategy. Any alteration to the30-second contract must be explicit; this packet does not recommend silently relaxing it.

Then require one actual merchant vertical flow and native acceptance/cleanup, finish the measured complexity work, and review the integrated milestone. A successful Function setup or merged blocker cannot substitute for that result. Preserve the M5-025 RED unsigned-metadata/generation assertion until the implemented lifecycle and native privacy obligations qualify. [Decision questions and resume boundary](PRINCIPAL-REVIEW.md).
