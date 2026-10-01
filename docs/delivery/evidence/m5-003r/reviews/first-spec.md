**Local Spec/correctness disposition: corrections required. One unresolved material P2 finding remains.** The external principal **CHANGES_REQUESTED** verdict still controls.

Reviewed `Optidigi/insignia` PR #29 at:

- Base/effective merge base: `8a84ddeaf277368852d224915abe6d4a93a3d8a4`
- HEAD: `0c8e473f4ed38aa5a66c62f4a1602067ca500a44`
- Tree: `5d15cf9887c16678ef67f131e519159a34928b30`

The refs matched the requested checkpoint. The worktree was clean at entry and completion. The complete base-to-HEAD diff was captured; its SHA-256 is `4fb2e92313d0fdd6b7b4ddd75e594f302b990a21fe561e9cf6dc63faaeb6934c`. PR #28’s approved merge parents and tree remain exact.

**P2 — hold admission can expire before publication dispatch.**

At [production-publication.ts:592](https://github.com/Optidigi/insignia/blob/0c8e473f4ed38aa5a66c62f4a1602067ca500a44/packages/database/src/repositories/production-publication.ts#L592), admission is checked once. The method then awaits three projection reads and another current-installation/key check before dispatching at [production-publication.ts:702](https://github.com/Optidigi/insignia/blob/0c8e473f4ed38aa5a66c62f4a1602067ca500a44/packages/database/src/repositories/production-publication.ts#L702).

The callback in [production-activation.ts:85](https://github.com/Optidigi/insignia/blob/0c8e473f4ed38aa5a66c62f4a1602067ca500a44/packages/database/src/repositories/production-activation.ts#L85) correctly evaluates the conservative observation origin, but returns only a boolean. Publication therefore loses the timestamp needed to reject admission that becomes stale during subsequent awaited work.

The exact invariant is that stale hold evidence must not authorize a publication write. M5-003R requires preserving the conservative origin through consuming checks and zero publication writes on stale admission.

I independently reproduced this through the **current public `createDurableCore(...).productionActivations.create(...).publications.advance(...)` facade**, using current database source, an in-memory synthetic pool/provider and injected clock:

1. Start with an owned `HELD` operation and current installation/key.
2. Return an exact held observation at `t0`, with a 1,000 ms freshness budget.
3. Advance the clock by 2,000 ms during the subsequent `public_config` projection read.
4. Publication still dispatches one write and returns `PENDING / shop-config-written`.

Observed output:

```json
{"result":{"kind":"PENDING","phase":"shop-config-written"},"publicationWrites":1,"holdAgeAtDispatchMs":2000,"budgetMs":1000}
```

This establishes a local freshness defect; it does not establish a live checkout bypass.

Necessary correction: retain the admission observation origin and check its age after the final awaited preparation/current-state work, immediately before dispatch. Expired admission must return pending with zero writes. Add a permanent **actual public PostgreSQL regression** delaying projection/current-state work after a successful fresh hold check. The existing [R1 integration cases](https://github.com/Optidigi/insignia/blob/0c8e473f4ed38aa5a66c62f4a1602067ca500a44/packages/database/test/activation.test.ts#L411) cover delays inside the availability observation, leaving this interval uncovered. Preserve exact-boundary, future/reversed-clock and same-mode behavior.

**Scope and dispositions**

I read the full current new/changed source and tests, plus interacting publication, keys/artifact/readiness, database facade/config/tenant/signing/publication/credential repositories and migrations; Shopify hold/catalog/auth/CAS adapters; Admin composition/service/editor/shared state; geometry/visualizer; and relevant root scripts, boundaries, CI and build/browser regression paths. Authority, both briefs, reports, historical corrections and sanitized evidence were inspected.

| Brief sections | Disposition |
|---|---|
| 1–3: hold abstraction, Shopify adapter, admission classifier | R2 preserves distinct `unlisted` state and exact restoration. R1 normalization preserves pre-I/O origin and complete receipt. Publication dispatch freshness remains defective as described above. |
| 4–5: immutable evidence and release trust | Exact identity binding and production `RELEASE_BOUND` requirement retained; no default release authority introduced. |
| 6–7: activation and crash/recovery | Evidence/effective activation commit together; final activation/restoration revalidation, installation/epoch/key/sequence fences and one-use dispatch claims retained. |
| 8–9: Admin/recovery reads and history plans | Recovery stays visible across supersession/reinstall. Trusted settlement remains indispensable. Retained pointer/fallback/Admin plans use intended indexes. |
| 10–13: restrictions, tests, work split and review | No additional material scope or public-facade bypass found. Crash/race tests retain ambiguous-write, restart, drift and concurrent-resolution coverage. Additional dispatch-age regression is required. |
| 14–16: acceptance, exclusions and handoff | Local clearance is withheld because of the finding. Principal rereview remains required; no successor work or gate acceptance follows. |

No additional material runtime/API/persistence regression was identified. Optional `receivedAt` is additive; legacy timestamps are neither rewritten nor retroactively qualified. The R correction changes no SQL migration.

**Execution versus supplied evidence**

Commands I actually executed included:

- Read-only Git ref/status/log/diff inspection and `git diff --check` — exit 0.
- `node node_modules/typescript/bin/tsc -p … --noEmit` for application, Shopify and database — all exit 0.
- `node --test apps/web/test/admin/activation-state.test.mjs apps/web/test/admin/release-evidence.test.mjs` — exit 0.
- The Node 24.21.0 in-memory public-facade reproducer above — demonstrated the defect.
- Python hash and retained-plan inspection — all six query bindings and all 19 sanitized-log hashes matched.

I inspected, but **did not rerun**, supplied application174, Shopify221, PG97, HTTP16, worker15, root PASS, stress100/100, renderer-control, strict-fixture, style and secrets results. R1 reds are attributed to old source; R2 reds to the R1-corrected/R2-uncorrected intermediate. Permanent tests exercise implementation modules.

The retained 100,001-row plans remain bound by six matching current hashes. No new measurement or machine SLA is claimed.

This was a sequential read-only review with no delegation or prohibited operations. The supplied explicit GPT-6.1-sol/high launch context is the execution-setting record; no provider-private attestation is claimed.

Live all-channel/in-flight admission remains unproved. Product status has no native atomic CAS. No production release source or genuine `RELEASE_BOUND` record exists; injected synthetic premises are test inputs. Production operator-recovery authority remains unwired. `DEV_PREVIEW_OBSERVED` remains live-unqualified, remaining G7 obligations stay open, and **no M5 completion, principal approval or gate pass is granted**.