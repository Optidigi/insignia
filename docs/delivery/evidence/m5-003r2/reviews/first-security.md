**One unresolved material finding: P2 restoration freshness expires inside the final synchronous guard.** My local Standards/security disposition is **changes required**. This is not principal approval.

Attributed to `/root`, fresh independent read-only reviewer, 1 October 2026. No delegation, edits, network, builds, credentials, provider operations, pushes or merges occurred. The runtime did not expose model/effort attestation; I cannot certify this reviewer’s required `gpt-6.1-sol/high` provenance from supplied orchestrator receipts.

**Verified review identity**

```text
Base/effective base: 8a84ddeaf277368852d224915abe6d4a93a3d8a4
Candidate head:      1ee6bebd02f1ee4f57cc07ec553946231c7db8ab
Candidate tree:      cdf291d40532630e6ed872ef0b14edaf34b32ce4
```

`git rev-parse` and `git merge-base` matched those refs. The worktree was clean before and after review. The integrated three-dot diff was nonempty and contained 241 files; `git log base..HEAD` contained twelve commits, including the original implementation and subsequent corrections.

**P2 — Revalidate freshness after calendar preparation**

Location: [activation.ts:259](https://github.com/Optidigi/insignia/blob/1ee6bebd02f1ee4f57cc07ec553946231c7db8ab/packages/application/src/publication/activation.ts#L259), particularly the freshness checks using `decisionAt` at lines 284–289. Restoration consumes this result through [activation.ts:432](https://github.com/Optidigi/insignia/blob/1ee6bebd02f1ee4f57cc07ec553946231c7db8ab/packages/application/src/publication/activation.ts#L432); actual HTTP initiation follows the callback in [availability-hold.ts:358](https://github.com/Optidigi/insignia/blob/1ee6bebd02f1ee4f57cc07ec553946231c7db8ab/packages/shopify/src/availability-hold.ts#L358).

The required invariant is freshness **at actual HTTP initiation**, preserving the original observation time and inclusive 1,000 ms boundary. The [R2 brief:39](https://github.com/Optidigi/insignia/blob/1ee6bebd02f1ee4f57cc07ec553946231c7db8ab/docs/delivery/prompts/M5-003R2-TRANSPORT-DISPATCH-CLOSURE.md#L39) requires this through local preparation and explicitly includes the composed restoration path.

`decisionReady` captures `decisionAt`, performs calendar preparation, then validates artifact/Function, projection and hold freshness against the earlier timestamp. Its calendar watchdog permits preparation lasting up to the entire observation budget, regardless of how little freshness remains. The second calendar callback also runs after the watchdog’s ending timestamp.

I reproduced this using unchanged current application source composed with the real Shopify availability adapter, transpiled only in memory. The store, credentials, clock, release premises and fetch responses were synthetic. The probe recorded the clock **inside actual mutation fetch initiation**:

| Credential preparation | Final calendar preparation | Fetch initiation age | Returned result |
|---:|---:|---:|---|
| 950 ms | 0 ms | 950 ms | `ACTIVE` |
| 950 ms | 50 ms | 1,000 ms | `ACTIVE` |
| 950 ms | 51 ms | **1,001 ms** | **`ACTIVE`** |
| 950 ms | 100 ms | **1,050 ms** | **`ACTIVE`** |

For the last row, evidence remains valid at the captured 950 ms timestamp. Calendar preparation consumes another 100 ms and passes its watchdog. The guard approves, the adapter initiates the status mutation at 1,050 ms, and the coordinator records `RESTORED` and returns `ACTIVE`.

This requires no clock reversal, provider race or timeout. The permanent credential-delay matrix does not cover preparation consuming the remaining budget **inside** the final guard.

**Narrow correction:** validate original evidence ages, expiry and monotonic time after calendar preparation, ensuring the accepted merchant day and final decision instant remain consistent without another unchecked preparation step. Retain the existing transport guard, inclusive boundary, immutable evidence and one-use restoration claim. Add composed regressions for the cases above: ages over 1,000 ms must produce zero mutation fetches and truthful restoration-pending behavior. Refusal must not recreate dispatch authority or permit replay.

The helper also serves activation decisions, so review that shared use when correcting it. I directly reproduced the restoration effect.

**Scope actually inspected**

I reviewed full current changed production source and permanent tests across the integrated PR, rather than treating archived principal snapshots as implementation:

- Application: publication activation, availability and recovery contracts; trusted-release source and tests; interacting artifact attestation, readiness, public configuration, cryptography, signing lifecycle and credential lifecycle/bridge.
- Database: durable core, client types, exports; production publication/activation, activation and recovery repositories; interacting publication, tenant, configuration, signing-key, credential and accepted-quote repositories; changed activation migration and interacting publication, installation, authorization, key and pointer migrations.
- Shopify: complete publication adapter/HTTP transport, availability adapter and catalog source; their changed tests; interacting Function ownership path.
- Admin: merchant service, activation projection, release-evidence composition, shared DTOs and complete editor; changed integration/state/publication/release tests and synthetic support; interacting production composition, authentication, contracts, HTTP boundary, runtime and API routes.
- Integration: package exports/configuration, relevant package scripts and lockfile changes, workflows, database facade boundary checker, dependency rules, worker handlers/runtime, Astro configuration, and large-history measurement script.

Authority inspected included `AGENTS.md`, ledger, relevant implementation-plan publication/security/persistence/Admin/gate sections, delivery state, operating model, agent roles, all sixteen original slice sections, both correction briefs, both principal verdicts, all three reports, code-review skill, issue-tracker mapping, tooling register, review template, and R2 evidence/register bindings.

The diff showed no changes in the checked frozen contracts/domain/Function, architecture or skill paths.

**Checks I executed**

All checks below were local and read-only:

- Ref resolution, merge-base, clean status, complete integrated diff enumeration and commit log: exit 0.
- `node --version`: `v24.21.0`.
- `node node_modules/typescript/bin/tsc -p <package>/tsconfig.json --noEmit` for application, database and Shopify: passed.
- Strict complete changed fixtures:

  ```text
  node node_modules/typescript/bin/tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck packages/database/test/activation.test.ts packages/shopify/test/publication-admin.test.ts packages/shopify/test/availability-hold.test.ts
  ```

  Passed.
- Pure in-memory publication transport controls: four write shapes × ages `0/999/1000/1001/2000/-1`; twelve permitted and twelve denied cases. Denied cases produced zero mutation fetches. These were transport controls, not a PostgreSQL execution.
- Pure in-memory late-credential deadline control: zero late mutation fetches.
- Pure in-memory lost-response control: one mutation and one exact recovery read, without a second mutation.
- Composed restoration counterexample above: reproduced two freshness violations. Exit 0 denotes successful characterization, **not invariant compliance**.
- SHA-256 comparisons: all six retained query bindings and fourteen published log hashes matched.

One supplemental probe initially failed because its loader resolved a package dependency from the workspace root. Resolving dependencies relative to their source package corrected the harness; the unchanged-source boundary probe then completed.

**Receipts inspected, not executed by me**

The retained receipts report full root PASS, PostgreSQL 139/139, HTTP 16/16, worker 15/15, Shopify 226/226, stress 100/100 without retry, renderer negative-control wrapper PASS, and strict fixtures PASS. I inspected their summaries and preserved intermediate failures, including the original expired publication fetch and restoration `DRAFT → ACTIVE` observations.

The retained query artifact contains 100,001 operations/revisions and the bounded pointer/fallback plans. Its six bindings match current files, including supplied built artifacts. I neither rebuilt those artifacts nor reran PostgreSQL measurements. Its quote-readiness result remains deliberately fail-closed; it establishes no machine SLA.

**Other Standards/security conclusions**

No additional unresolved material finding emerged within the inspected scope. Publication now carries its internal admission predicate through final SQL/key work and credential preparation to actual fetch. Browser/environment inputs cannot provide approving authority. Before-send refusal remains distinct from already-sent ambiguity; publication retains compareDigest/readback behavior.

Restoration claims remain one-use, activation/resolution evidence remains immutable, and recovery requires separately trusted settlement evidence. Acquisition has distinct owned-intent, snapshot and current-installation premises; I found no basis to impose an additional release-authentication framework on it. Optional style findings: none raised.

Principal verdict remains **CHANGES_REQUESTED**. This review proves no native status CAS, all-channel propagation or in-flight drainage; no live `RELEASE_BOUND` or trusted production recovery source. `DEV_PREVIEW_OBSERVED` remains live-unqualified, G7 obligations remain open, and no M5 or gate completion is claimed. Exact-head remote CI and principal approval were not verified in this offline review.
