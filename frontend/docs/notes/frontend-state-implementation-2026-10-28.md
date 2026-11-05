# Frontend state implementation

Status: implemented locally and independently reviewed. The owner approved the complete frontend migration and native Preact for the polished buyer. Recovery and verification finished on 28 October after interruptions. This records source implementation and local tests; deployment and release approval remain separate.

## Baseline and recovery

The source snapshot is `/tmp/insignia-frontend-baseline-20261027-232033`, with rewrite and sibling archives, SHA-256 manifest and original Git status. `.artifacts/frontend-state-baseline-path.txt` points to it. It preserves the extensive pre-existing uncommitted design work. No reset, unrelated commit or production operation was performed.

The approved [migration plan](../../architecture/frontend-state-migration-plan.md) governs ownership and verification. The owner's later instruction supersedes its separate React-runtime retention: the polished buyer is being migrated to native Preact 10.29.8, matching production. Astro document routes and Shopify-owned screens retain their current responsibilities.

Initial checks before changes passed: 36 strict compiler projects; 22 focused upload/archive/production identity/Home source/request checks. The production buyer implementation subsequently passed 57 tests with two environment-gated skips and ten new model/controller checks. These observations predate final integrated verification.

## Work and ownership ledger

| Family | Implementation or retained owner | Status |
| --- | --- | --- |
| Production buyer | Typed buyer workflow/controller, current request/product and mutation ownership, operation-specific completion. Existing cart protocol and custom-element lifecycle retained. | Implemented; 57 tests pass, two native prerequisites skip. Independent Luna source review has no remaining finding. |
| Polished buyer | Native Preact dependency/import/render conversion, semantic designer reducers and repeatable isolated browser suite. | Build, 62 configuration checks and seven browser tests pass across all 13 scenarios. Independent source and rendered review completed. |
| Polished merchant editor/Methods | Typed workspace/photo/session/staged manager and route workflows; document/history remains sole commit owner. | Implemented; manual/variant photo, history, pricing, navigation and suspended-picker correction journeys pass. Sol reviewed actual desktop/phone screens and reran staged picker/late-hide cases. |
| Persisted merchant editor/Methods CRUD | Independent save/publication transactions, exact pending identities and staged CRUD. | Editor and Methods suspension recovery are implemented. Independent Sol review passes three editor lifecycle and three Methods browser cases, including exact retries and stale completion overlap. |
| Products/Orders | Query/read/page selection reducers; URL and cursor restoration remain adapter-owned. | Implemented. Query change keeps the toolbar mounted while clearing old rows; three targeted browser cases pass, independently rerun by Sol. |
| Purchase/artwork | Read observation model plus identity-scoped attachment staging and commands. Private preview resources retain their existing owner. | Implemented. The 89-case production browser group passed 84 initially; three Orders regressions were corrected, two remaining failures reproduce on baseline. |
| Upload | Pure lease metadata/operation model; private URL resources, cancellation and callbacks remain hook-owned. | Existing upload browser tests and new sequence checks pass. |
| ZIP/worksheet exports | Shared preparation lifecycle used by three actual export owners; independent bytes/disposal, synchronous claims and attempt identity. | Implemented; archive/worksheet browser and lifecycle checks pass. Independent Luna source review has no remaining finding. |
| Home | Source-specific read unions retained; guide preferences and create/retry decisions now pure models. Storage effects stay outside transitions. | Browser/model checks pass; Sol inspected fresh desktop/phone captures. |
| Billing | Tagged current read observation, abort/generation cleanup and existing Shopify handoff. | Browser check passes; independent Luna reviewed read ownership and adapters. |
| Permissions | Consent/check/scopes/server-readback model, synchronous command claim and mounted-attempt guard. Parent issue flag stays local. | Browser/model checks pass; no consent is inferred from a button click. |
| Storefront setup/test | Existing typed theme/test states, product-scoped request sequence, host consent/readback and cleanup retained. | Retained as already structured owners; browser/model checks pass. |
| Shared shell/controls | Save/leave confirmation model; full-document navigation and independent input/disclosure state retained. A cancelable resume event lets a surviving command owner authenticate in place. | Immediate discard-dialog reopening passes root and independent Sol browser checks. Unclaimed Settings/Orders still reload on persisted pageshow, independently verified. |
| Gallery/preview integration | Preserve explicit simulation, postMessage validation and actual asset routing. | Route allowlist checks pass; all 460 linked gallery PNGs return 200 with valid dimensions. |

## Verification method

Some existing browser tests still encode earlier presentation assumptions, including the old worksheet caption, old Methods field label and hidden skeleton counts. Compare against the preserved baseline before attributing failures to the refactor. Do not weaken behavioral/privacy checks to get a pass. The worksheet test now asserts garment name/quantity in actual printed text and samples the current header coordinates; renderer source was unchanged.

The sibling's build and configuration checks cannot establish UI behavior alone. Its maintained Node/Playwright suite must identify the source snapshot, start an isolated loopback server and verify all current scenarios plus new/edit/resume/undo/return/upload behavior. Root compiler checks do not automatically cover the sibling.

Integrated source/type/style/build checks and scoped browser/resource checks are complete. Independent source, concurrency/recovery and rendered-flow reviews have no remaining material finding. Native purchase integration and Shopify Functions proof remain separate from synthetic browser evidence. No deployment or backend integration is included.

## Retained boundaries

`PrivatePreviewImage`, original-download decoding, historical preview, renderer and pointer resources retain their bounded abort/epoch/disposal owners. They do not need another parallel reducer. Storefront setup and product-test flows already use tagged states and scoped native-host observations. Full-document admin navigation, date/filter input drafts, ordinary disclosures, table columns and static Settings remain local. Production never imports a preview state module. Preview host/postMessage parsing keeps its existing validation and simulation boundary.

No XState, Redux, React compatibility layer, global frontend store or effect queue was added. Both interactive applications use native Preact 10.29.8. Astro still owns server-rendered document routes. The sibling's manifest has no React or ReactDOM dependency, and active source imports contain no React or `preact/compat` reference.

The existing merchant save/Methods bodies are not newly stored in browser persistence. Surviving back-forward-cache documents must reconcile retained commands on authenticated resume. Full document destruction, including a reload or a user-confirmed native leave prompt, discards its nonpersisted private draft and command bodies; the next document reads current server facts under existing CAS/idempotency rules. Exact replay of a private body after document destruction is not claimed. Existing publication metadata and buyer cart recovery retain their separate contracts.

## Verification record

Checks use Node 24.21.0. The initial broad integrated run exercised 654 merchant/shared tests: 544 passed, 49 failed, one was cancelled and 60 capture/native prerequisite tests skipped. That run preceded the final corrective passes, so its failures are not a final candidate tally. Each migration regression was followed by a scoped rerun. Failure conditions remaining outside those corrections were reproduced on the preserved baseline rather than assumed unrelated.

| Evidence | Observation |
| --- | --- |
| Strict projects | Final 36-project strict check passes with zero uncovered TypeScript files. |
| Source/style | Source coverage passes; repository formatting/lint has no errors, with existing warnings and informational suggestions. |
| Merchant build | Final Astro build passes; 168 files checked with zero errors, warnings or hints. |
| Buyer build | Native Preact TypeScript/Vite build passes. Production theme build and asset copy pass in a disposable candidate, leaving maintained theme assets untouched. |
| Polished buyer | Seven browser tests pass, covering 13 scenarios, new/edit/replace/resume, return/cart, undo, upload cancellation, colour quantities and synchronous double Add to cart. Source SHA-256 `dbec391b3ec181ba670d2b6d7a7506a6d848b932d5c0386f2229003655a7d78b`. |
| Production buyer | 57 pass, zero failures; database purchase integration and native Functions runner account for two explicit skips. |
| Shared upload/export | Existing upload browser checks and new lifecycle tests pass. Prepared worksheet image/text/geometry tests pass after correcting stale caption coordinates. |
| Root corrected journeys | Five browser cases pass for Orders query focus/loading/chips, immediate Save Bar discard and production Methods. Sol independently reran the four Orders/Save Bar cases with no skip. |
| Editor suspension | Sol independently reran three current cases for first-configuration creation, delayed save resume/exact retry and generation/access change. The held retry stays loading when the stale pre-suspension response finishes. These use synthetic PageTransitionEvents, not proof of native browser cache admission. |
| Manual photos and first product | Both manual/variant assignment journeys pass; first-product setup passes after readiness corrections. Eight other distinct post-fix placement journeys pass. |
| Methods suspended picker | Three navigation/picker journeys plus dialog focus pass; Sol independently reran staged Keep editing/Discard and delayed hide completion. |
| Gallery | All 460 linked image responses are valid PNGs with expected nonzero screenshot dimensions; route traversal/allowlist checks pass. |
| Signing test environment | All 17 owner-action tests pass with canonical macOS temp paths. Their default `/var` versus `/private/var` failure reproduces on baseline. The frontend runner canonicalizes only its child-test temporary directory. |

The maintained command is `INSIGNIA_DESIGNER_PROTOTYPE_ROOT=/absolute/path/to/designer-prototype corepack pnpm test:frontend`. A missing sibling is a failed prerequisite, not a skip. It builds both buyers and merchant source, checks effective types/source/style, and runs merchant/shared and production buyer tests. Generated theme output is isolated and deleted. Test-group failures remain nonzero while allowing the other independent test group to report. Existing failing assertions are not excluded from this command.

`corepack pnpm test:frontend:models` provides the fast repository feedback loop. Its final 70 model/controller tests pass without a browser; the reported test duration is 817ms. It covers the production buyer and repository merchant/shared models; the separate polished buyer still requires its explicit-source browser suite and build.

## Baseline failures kept visible

The remaining broad browser failure conditions reproduce on the untouched snapshot:

- Eight editor assertions for old sidebar/Search/layout/skeleton/removal expectations, and one cold-load Methods heading assertion.
- Methods overview row height, three placement assertions for Preview/upload retry readiness, and two order focus/date-panel assertions.
- Seven preview composition/action assertions, including the old production-sheet warning, plus two shared-control/recovery assertions.

This is 24 baseline failure conditions, including the previously cancelled editor journey. These are not counted as successful verification. Some are stale tests and others may describe pre-existing UI defects; reproducing them does not establish that they should be ignored permanently. The broader Polaris presentation boundary check also reports 123 diagnostics on both baseline and current source, with an identical normalized multiset and no new violation. No validator whitelist was weakened to hide them.

Stale tests corrected in this task retain behavioral checks: active skeleton scope, actual Methods field label and saved copy, current product-column width, and worksheet caption/printed header sampling. The attachment test now exercises the supported operation path; stale read replacement is separately checked through the actual read model. No hidden refresh control was added to satisfy an obsolete test.

## Independent review and correction passes

Luna xhigh authors and verifiers handled separate workflow families and baseline reproductions. An independent Luna Max reviewer inspected stable root/buyer ownership and found the colour-row/cart-latch regression. A failing maintained model test reproduced it. The whole-design colour rule is restored, the duplicate cart latch is removed, and the actual browser journey now switches swatch after entering quantities and double-clicks Add to cart before render. The reviewer checked the fix and passing seven-test log.

One independent Sol reviewer inspected actual baseline/current Methods and placement desktop/phone images, fresh Home captures, Orders, buyer dark/long-content/cart views, and exercised public Methods and buyer phone flows. They independently reran late Orders/Save Bar and suspended-picker fixes. No outstanding rendered finding remains within that inspected scope.

A second independent Sol reviewer initially ran 32 model tests and inspected production and preview command wiring. They found missing no-storage publication retention, suspended picker draft loss, and a carried-forward pagehide/save lifetime gap. All three now have corrected source and passing independent checks. The save fix required a shared-shell resume handshake, authenticated observation of the retained command, separate changed-context handling, and epoch-fenced mutation cleanup. The reviewer also verified first-config creation releases its own load claim. The same shell reload gap in Methods is also corrected: suspension retains the command, authenticated read precedes reveal, and only manual exact retry is allowed. Epoch checks reject old results before list updates. Final independent checks pass 37 model tests, three editor lifecycle cases, three Methods browser cases and two default-shell reload probes. Standards and spec reviews have zero unresolved findings. Full-document reload limits are stated above rather than concealed by a new private-payload store.

Detailed local receipts are under `/tmp/frontend-*.log`, `/tmp/frontend-independent-luna-review.md`, `/tmp/frontend-sol-screen-review.md`, `/tmp/frontend-sol-transition-review.md`, `/tmp/merchant-preview-state-result.md` and `/tmp/production-merchant-state-result.md`. The baseline manifest and generated source-difference/PNG receipts are in `.artifacts`. These are local implementation and review observations, not native Shopify acceptance, deployment or release approval.
