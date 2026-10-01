**Local Spec/correctness result: one unresolved material finding (P2). The candidate needs correction before principal rereview.** This is an independent read-only review, not principal approval.

Verified identity:

| Item | Exact value |
|---|---|
| Repository / candidate | `Optidigi/insignia`, existing PR #29 |
| Base and effective merge base | `8a84ddeaf277368852d224915abe6d4a93a3d8a4` |
| Head | `1ee6bebd02f1ee4f57cc07ec553946231c7db8ab` |
| Tree | `cdf291d40532630e6ed872ef0b14edaf34b32ce4` |
| Worktree | Clean at entry and exit |
| Commit range | 12 commits; original implementation through both corrections |

Reviewer attribution: this fresh session performed the Spec/correctness review without delegation. The host does not expose independently verifiable model/effort metadata to me, so I cannot attest the requested actual `gpt-6.1-sol/high` selection. Historical runtime receipts do not establish this session’s model.

**Material finding — P2: final freshness validation uses the time before synchronous calendar preparation.**

Primary location: [activation.ts:259](https://github.com/Optidigi/insignia/blob/1ee6bebd02f1ee4f57cc07ec553946231c7db8ab/packages/application/src/publication/activation.ts#L259), particularly the freshness checks at lines 284–289. Affected callers are the restoration dispatch predicate at [activation.ts:434](https://github.com/Optidigi/insignia/blob/1ee6bebd02f1ee4f57cc07ec553946231c7db8ab/packages/application/src/publication/activation.ts#L434) and activation evidence construction at [activation.ts:540](https://github.com/Optidigi/insignia/blob/1ee6bebd02f1ee4f57cc07ec553946231c7db8ab/packages/application/src/publication/activation.ts#L540).

The controlling requirements are original M5-003 §6’s fresh final activation decision and [M5-003R2 §3](https://github.com/Optidigi/insignia/blob/1ee6bebd02f1ee4f57cc07ec553946231c7db8ab/docs/delivery/prompts/M5-003R2-TRANSPORT-DISPATCH-CLOSURE.md#L45): required readiness must remain fresh synchronously at actual HTTP initiation, preserving the original observation time.

`decisionReady` samples `decisionAt`, then calls `currentDay`. It checks the calendar calculation’s duration against the full budget, but subsequently validates Function, projection and hold freshness against the earlier `decisionAt`. Evidence age and calendar duration are therefore checked separately. Their combined duration can exceed the budget while the predicate returns true. The second `currentDay` invocation also occurs after the last clock sample.

I reproduced this with unmodified current coordinator and availability-adapter source, loaded entirely in memory. The persistence fixture, credentials, clock, release premises and HTTP responses were synthetic; the adapter’s injected `fetch` counted actual HTTP initiation.

| Restoration case, budget 1000 ms | Actual `ACTIVE` fetches | Age at fetch | Result |
|---|---:|---:|---|
| Immediate control | 1 | 0 ms | `ACTIVE`, `RESTORED` |
| Credential preparation 999 ms, then synchronous boundary calendar calculation 2 ms | **1** | **1001 ms** | **`ACTIVE`, `RESTORED`** |

The HTTP adapter invokes the predicate immediately before `fetch`, correctly positioned at [availability-hold.ts:361](https://github.com/Optidigi/insignia/blob/1ee6bebd02f1ee4f57cc07ec553946231c7db8ab/packages/shopify/src/availability-hold.ts#L361). The predicate approves using age 999 ms although actual initiation occurs at age 1001 ms. The required result is zero status mutations and a truthful pending outcome retaining the one-use restoration claim.

A separate source-loaded same-mode activation probe reproduced the same helper defect: it committed `ACTIVE` at actual age 1001 ms while recording `createdAt` at age 999 ms. The immediate control committed at age 0. This is a second consequence of the same finding.

The narrow correction is to complete calendar preparation and consistency checks before the final time sample, then revalidate the original Function/release, projection and hold observations at that final instant. Preserve monotonic checks and use that instant for activation evidence. Add composed regressions combining near-boundary credential delay with synchronous calendar work, including work in the second calendar call. No new authentication, lease or persistence framework is needed.

**Scope actually inspected**

I read the full current changed production source and tests across the integrated PR, including earlier implementation commits. The principal diagnostic snapshots were treated as archived evidence.

- Application: complete `publication/{activation,availability,availability-recovery}.ts`, `keys/trusted-release.ts`, their changed tests and exports; interacting artifact-attestation, public-config, crypto and readiness contracts.
- Database: complete activation, production-activation, production-publication and availability-recovery repositories; public facade, client types and exports; interacting publication, configuration, accepted-quote, tenant and signing-key repositories; changed activation/public-admission/publication tests.
- Migrations: complete new activation migration and interacting installation, authorization, signing-key, accepted-quote, publication-progress and M5 revision/pointer migrations; relevant durable-core publication and effective-pointer guards.
- Shopify: complete availability-hold, publication-admin and catalog source/tests and exports; interacting credential contract, Function ownership and deadlines.
- Web: complete changed merchant configuration service, activation/release state modules, shared view, editor island and changed integration/state/publication/release fixtures; interacting production composition, authentication, HTTP routing and quote readiness.
- Boundaries/build/query: database API boundary script, dependency rules, large-history script, package/build configuration, changed workflows and root/lockfile changes.
- Authority: AGENTS, ledger, relevant plan sections, delivery state/operating model/roles, all 16 original prompt sections, R and R2 prompts, both principal verdicts, all three reports, review skill, issue-tracker instructions and review-packet template.
- Evidence: R2 README, verification, provenance and logs; retained query artifact and all six current bindings.

**Original outcomes and preserved correction semantics**

| Original section | Review disposition |
|---|---|
| 1. Hold abstraction | Scope-bound snapshots, ownership and explicit outcomes inspected. |
| 2. Shopify adapter | Original observation origin, receipt bounds, exact visibility/status handling and ambiguity inspected. Native status CAS remains unavailable. |
| 3. Classifier | First publication/reinstall and mode changes require holds; permitted same-mode path remains without a hold. |
| 4. Immutable evidence | Revision/scope/sequence/projection bindings and immutable SQL guards inspected. Timestamp consequence affected by the finding above. |
| 5. Release authority | Expected build and trusted evidence are separate server ports. Browser/environment values do not create approving authority; no live production source is supplied. |
| 6. Coordinator | Locking, fences, observations and atomic evidence/effective transition inspected. Final freshness remains defective as reported. |
| 7. Crash/recovery | Persisted acquisition intent, committed one-use restoration claim, conservative ambiguous-send handling and trusted audited recovery inspected. |
| 8. Admin states | Current/effective publication, held/pending/operator/resolved distinctions inspected; no additional material state-reporting defect found. |
| 9. Large history | Query source and retained 100001-row evidence inspected; six bindings match. No measurement rerun. |
| 10. No remote work | This review performed none. |
| 11. Tests | Permanent tests inspected; combined evidence age plus synchronous calendar work is missing coverage. |
| 12. Work split | Historical records inspected; this reviewer performed no delegation. |
| 13. Fresh reviews | This report supplies this session’s Spec axis only, with the model-provenance limitation stated above. |
| 14. Acceptance | “No unresolved material issue” is unmet. Local passing receipts cannot establish live qualification. |
| 15. Scope exclusions | No additional material scope creep found; frozen economics, v2 and governance remain unchanged. |
| 16. Handoff | Existing principal-review boundary remains; no approval or successor work authorized here. |

For R/R2, I traced the public database facade through publication coordination, the real Shopify adapter, HTTP transport, credentials and actual fetch initiation. The four publication write shapes carry the internal freshness predicate beyond final SQL and credential preparation. Inclusive 1000 ms checks, monotonic validation, bounded pre-send waiting, late-continuation guards, CAS/readback and before-send versus already-sent classifications are present. Acquisition retains its distinct installation/status/readback premises. The adjacent restoration predicate has the unresolved defect above.

No additional unresolved material Spec/correctness finding was identified.

**Commands I executed versus receipts inspected**

| My execution | Result |
|---|---|
| `git rev-parse`, `git merge-base`, entry/exit `git status --porcelain=v1` | PASS; exact refs and clean worktree |
| `git diff 8a84ddeaf277368852d224915abe6d4a93a3d8a4...HEAD` and `git log …..HEAD --oneline` | Executed; full integrated diff captured |
| `node node_modules/typescript/bin/tsc -p <package>/tsconfig.json --noEmit`, for application, Shopify and database | Exit 0 for all three |
| Strict `tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck` over database activation and both changed Shopify mutation fixtures | Exit 0 |
| `node --test apps/web/test/admin/activation-state.test.mjs` | Exit 0; runner reported one passing file |
| Source-loaded `node --input-type=module` in-memory diagnostics | Exit 0; exposed the violated invariant described above |
| Read-only SHA-256 verification | All 14 R2 published log hashes and six query bindings match |
| `git diff --check <base>...HEAD` | Exit 2; optional whitespace observations below |

The full diff contained 241 file entries, 1,584,337 bytes, SHA-256 `dbf86a2720cd13b6842128e7db9063005d489086847fbe3529c9f3433f0ab2e4`.

I inspected, but did **not** execute, the retained full-root PASS, PostgreSQL 139/139, HTTP 16/16, worker 15/15, Shopify 226/226, stress 100/100 without retries, renderer negative-control wrapper PASS and strict-fixture PASS receipts. The renderer receipt contains its expected inner failure. The intermediate `activation-green.log` retains two failures; it was not treated as a passing final receipt.

The preserved baseline failures show one expired publication HTTP mutation and restoration statuses `DRAFT → ACTIVE`. Corrected public matrix receipts count actual fetches. Query-plan receipts retain 100001 history rows and the larger surrounding dataset; matching existing bindings establish artifact consistency, not a fresh database measurement.

**Optional style observations**

`git diff --check` reports an extra final blank line in three historical R logs: `dispatch-correction-postgres.log:14`, `r1-dispatch-pg-green.log:9`, and `r1-dispatch-pg-red.log:139`. These are nonblocking evidence formatting notes.

The external principal verdict remains **CHANGES_REQUESTED**. There is no native status-CAS, all-channel, drainage or in-flight proof; no live `RELEASE_BOUND` or trusted production recovery source; `DEV_PREVIEW_OBSERVED` remains live-unqualified. G7 obligations and M5/gate completion remain outstanding. No network, credentials, Shopify CLI, provider/browser/DB operations, builds, edits, pushes or merges were performed.
