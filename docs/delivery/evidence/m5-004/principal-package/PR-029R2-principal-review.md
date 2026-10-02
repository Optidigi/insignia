# PR #29 principal rereview — APPROVED

Issued 1 October 2026 UTC. External principal: ChatGPT, Insignia Rewrite Project.

## Exact binding and authority

| Field | Approved value |
|---|---|
| Repository / PR | `Optidigi/insignia` / #29 |
| Base / effective merge base | `8a84ddeaf277368852d224915abe6d4a93a3d8a4` |
| Approved head | `7a67028d55c191d9c83816312844f2e9cd62d648` |
| Approved tree | `5f3f29d44da7d5f0423fd6902c19dc501f7c79ff` |
| GitHub test-merge object | `6bdc72f20436a8010e8d36db513a0dc0079e2be5` |

The test-merge object has the exact ordered base/head parents and approved tree. It is a CI candidate, **not an actual merge of PR #29**. At review, `main` remains the base above and #29 is open, non-draft and unmerged. The native-review endpoint returns no reviews. This document is an external principal verdict; no native approval was submitted and no merge or Shopify operation was performed by this principal.

**APPROVED for normal owner-authorized merge of the local/off-store M5-003 implementation, including M5-003R and M5-003R2.** This supersedes the CHANGES_REQUESTED dispositions in `PR-029-principal-review.md` and `PR-029R-principal-review.md` at their earlier heads. Preserve those records and their failed evidence.

No remaining merge-blocking finding was identified in the corrected paths and their reviewed integration. Approval does not complete M5, accept G6/G7 or another complete gate, qualify a live availability hold, or authorize production activation.

## Spec/correctness disposition

**R1 — conservative observation origin: CLOSED.** Freshness starts before credential/provider/body work. Additive receipt time bounds legitimate provider timestamps without renewing the origin. Earlier stored timestamps are not rewritten or retroactively qualified.

**R2 — legal UNLISTED status: CLOSED and retained.** Catalog and hold normalization preserve unlisted separately from ACTIVE and DRAFT. Exact UNLISTED restoration remains covered; unknown states and observed merchant drift still reject. This is provider-contract support, not a new commercial scope.

**R1-T — actual transport dispatch: CLOSED.** The server-owned predicate is carried separately from provider JSON through publication adapter and HTTP transport. After credential preparation and serialization, the final synchronous check precedes the actual fetch. All four publication write shapes use it. A latched deadline prevents late completion of credential work from initiating a request. Known pre-send refusal is `not_dispatched`; it is not fabricated as a sent/ambiguous mutation, does not advance publication, and does not consume ambiguous-retry state.

**Adjacent restoration: CLOSED at the local implementation scope.** The real status adapter receives the coordinator's readiness check through its additional read/credential preparation. NOT_DISPATCHED leaves the one-use RESTORATION_CLAIMED record, immutable evidence and already-effective revision intact. Subsequent invocations do not reconstruct dispatch authority. Actual sent-but-unknown outcomes retain their separate observation/recovery semantics.

**Calendar preparation: CLOSED.** The final helper accounts for time consumed by both calendar computations, uses at most three synchronous samples, rejects reversal/nonfinite/nonsettling time and changed merchant day, and checks original evidence age and key coverage at the final settled decision instant. The same instant is recorded in immutable activation evidence. This bounded local computation does not refresh external observations, retry a mutation, or create a persisted lease.

The permanent public PostgreSQL tests now cover the real coordinator → Shopify adapter → HTTP transport → injected fetch, including four-phase dispatch boundaries, the final actual SQL/key-read interval, credential failure/late completion, restoration and calendar preparation. The previously optional final-SQL regression is present.

## Standards/security disposition

No additional material standards/security defect was identified in the inspected correction and interacting paths. The predicate is an internal server-side precondition, not a browser-provided authority. Public facade isolation, tenant/install/key/epoch/sequence fencing, CAS/readback, immutable evidence and independently trusted recovery remain in place. Same-mode publication does not gain an unnecessary availability hold. No generic second authentication or lease framework is introduced.

The three historical evidence logs with trailing EOF blank lines are not a merge blocker. Preserve their measured bytes; do not add another unreviewed commit to clean them. Style output includes warnings/information and is not claimed warning-free.

## Verification performed

1. Read live PR metadata, corrective comparison, head/main/test-merge Git objects, native review state, complete current local-review packet and correction report. The current correction is three commits beyond the prior principal-reviewed head `91f46ba0006d9c5d50613dc39e234f33c797f625`.
2. Inspected corrected publication/availability transports, the production publication/admission paths, final activation/restoration readiness, permanent public integration tests and their inherited contract. Evaluated Spec and Standards/security axes in this principal session; no independent principal-side subagents were available or claimed. The two fresh local full-source reports remain separately attributed supporting evidence.
3. Independently executed **56 fixed-source synthetic cases** under Node **22.16.0**, with source bytes verified against three Git blob identities. All passed. The complete Shopify adapters/transports were executed; the database admission callback and caller guard/pass-through were exercised with a synthetic store. This was **not a full PostgreSQL coordinator execution**. Restoration used a synthetic pre-send predicate, not genuine release evidence. The principal did not independently execute the production calendar coordinator; its source, permanent tests, hosted execution and local-review probes supply that evidence. See `evidence/README.md` and `evidence/results.json`.
4. GitHub's head-filtered workflow query returned **ten completed successes, each run_attempt 1**, all bound to the approved head and #29 base. Independently read the actual M3 runtime job log (run `36920893479`, job `110566366200`). It records Node24.21.0, PostgreSQL18.6, **159 database tests**, Shopify226, application174, HTTP16 and worker15, plus migration application/repeat and rollback/reapply. The synthetic checkout has the approved tree. The other workflows were verified through metadata, not every job log.
5. The complete-root, **100/100 no-retry geometry stress**, strict-fixture, missing-renderer negative control and retained-query-binding claims were inspected in the execution packet. They were not independently rerun here. Environment-dependent skips in the DB-free root are not represented as a complete no-skips integration run; separate required PostgreSQL/HTTP/worker execution exists.

The probe's first harness attempt called the stateful admission predicate for logging, ignored its false result, then called it again. That did not match the production stop-on-refusal flow. The harness was corrected to use the predicate once; its earlier stderr is preserved and is **not a repository defect**. No production source was changed for this probe.

No full local checkout/build/Rust/Wasm/browser/PostgreSQL rerun, current live Shopify read, deployed-byte attestation, or complete rehash of every repository evidence file was performed by this principal. Direct container network retrieval was unavailable; repository content came through the GitHub connector. This rereview is not a new full M0–M11 reconstruction or a production-security certification.

## Remaining acceptance boundaries

- DRAFT transport and status readback have not yet been qualified on real Shopify through this adapter. No native product-status CAS, all-channel propagation or in-flight checkout drainage is proved.
- The HTTP guarantee ends at guarded local request initiation. It does not lock Shopify state or guarantee remote execution time.
- Genuine RELEASE_BOUND active-release provenance and a trusted production recovery source remain absent/unwired. SOURCE_ONLY and DEV_PREVIEW_OBSERVED remain insufficient for production activation; the latter also retains its live-qualification limits.
- Remaining embedded G7, supported publication/activation, M7 checkout-context/resource and later order/billing/privacy/release obligations remain attached to their existing milestones. No current product-config activation, key/FX activation or gate pass is accepted here.

## Correct next action

The owner may authorize a **normal merge of this exact #29 head**. Preserve the reviewed branch unchanged. Do not append this verdict or a successor prompt to #29 before merge; doing so would create a new unreviewed head. An attributed PR comment may relay the verdict without pretending it is a native review.

After verifying the actual normal merge's ordered parents and tree, the separately scoped `M5-004-AVAILABILITY-ADAPTER-LIVE-QUALIFICATION.md` may start **only when the owner forwards its launch authorization**. It tests a new unpublished disposable fixture, not live production activation. Import this verdict into delivery history on that new branch and preserve previous verdicts.

## Evidence pointers

- PR/current packet: https://github.com/Optidigi/insignia/pull/29#issuecomment-5940113122
- Current report: https://github.com/Optidigi/insignia/blob/7a67028d55c191d9c83816312844f2e9cd62d648/docs/delivery/M5-003R2-REPORT.md
- Current activation logic: https://github.com/Optidigi/insignia/blob/7a67028d55c191d9c83816312844f2e9cd62d648/packages/application/src/publication/activation.ts
- Current publication transport: https://github.com/Optidigi/insignia/blob/7a67028d55c191d9c83816312844f2e9cd62d648/packages/shopify/src/publication-admin.ts
- Current hold adapter: https://github.com/Optidigi/insignia/blob/7a67028d55c191d9c83816312844f2e9cd62d648/packages/shopify/src/availability-hold.ts
- Public PG regressions: https://github.com/Optidigi/insignia/blob/7a67028d55c191d9c83816312844f2e9cd62d648/packages/database/test/activation.test.ts
- Actual runtime job: https://github.com/Optidigi/insignia/actions/runs/36920893479/job/110566366200
- Workflow metadata and direct-check scope: `verification.json` in this package.
