**CHANGES_REQUESTED — one unresolved P1 Spec/correctness finding.** This is an independent local review, not principal approval or gate adjudication.

Reviewed exact refs:

- Base: `8a84ddeaf277368852d224915abe6d4a93a3d8a4`
- HEAD: `1e2765fe200b43b7f4aa2535da3cebfafbb58031`
- Tree: `876c70965ced86c18dd0c11bedd3456aef18f1e0`

Branch `feat/m5-003-activation-admission` remained clean. Merge-base equals the fixed base; approved PR #28 parents/tree are preserved. Complete `base...HEAD` diff: 836,191 bytes, SHA-256 `14dd1f8089c3455e72183e244505e253b5117259485ca16e3af5044e15756e96`. Diff whitespace check passed.

**P1 — Original-state readback prematurely settles an ambiguous restoration.**

At [availability-hold.ts:511](/home/serveradmin/insignia-m5-003-worktree/packages/shopify/src/availability-hold.ts:511), `(!acknowledged || …)` allows a timed-out/unacknowledged mutation to return `RESTORED` when readback shows the original status, visibility and a newer version. That observation cannot establish that the outstanding non-CAS write has settled.

The coordinator trusts this result and saves `RESTORED` at [activation.ts:415](/home/serveradmin/insignia-m5-003-worktree/packages/application/src/publication/activation.ts:415). Subsequent publication excludes that record from unresolved holds at [production-publication.ts:342](/home/serveradmin/insignia-m5-003-worktree/packages/database/src/repositories/production-publication.ts:342).

**Invariant:** brief §§2, 7 and 14.6 require recovery to avoid blind restoration or overwriting merchant state. The recovery contract also explicitly requires independently established settlement of outstanding writes.

**Independently executed reproducer:** current adapter source transpiled entirely in memory, with synthetic transport and no network:

1. Acquire an acknowledged DRAFT hold.
2. Dispatch restoration to ACTIVE; leave its HTTP promise unresolved.
3. Independently change remote status to ACTIVE with a newer version.
4. Let restoration time out. Readback causes the adapter to return `RESTORED`.
5. Acquire another DRAFT hold.
6. Complete the old restoration; it overwrites that new hold with ACTIVE.

Observed output:

```json
{"restoreResult":"RESTORED","oldWriteStillInFlight":true,"newHoldResult":"HELD","statusBeforeLateWrite":"DRAFT","writes":3}
{"statusAfterLateWrite":"ACTIVE","oldRestoreOverwroteNewHold":true}
```

The adapter behavior was executed; durable closure and subsequent-publication consequences were established by source inspection.

**Necessary correction:** an ambiguous/unacknowledged restoration must retain unresolved dispatch ownership until independently trusted settlement. Original-state readback alone must not produce `RESTORED`. Preserve acknowledged-success/readback handling and the no-write original-DRAFT case. Revise [the retained lost-response expectation](/home/serveradmin/insignia-m5-003-worktree/packages/shopify/test/availability-hold.test.ts:310), and add adapter, coordinator and PostgreSQL regressions covering an outstanding request, independent original-state change, blocked subsequent publication, and late completion.

The new durable `RESTORATION_CLAIMED` transition closes the earlier automatic redispatch defect: only its owning invocation dispatches, while later callers observe. The audited-abandonment tail logic addresses the earlier publication blockage, checks every intervening current-installation operation and exact effective anchors, and places same-command replay before sequence-mismatch rejection. The quote-issuance guard remains unchanged. **Neither correction closes the finding above.**

I read the required authority, operating-model, role, report and skill documents; full new/changed executable source and tests; interacting application publication/key/artifact/readiness logic; database facade, repositories and all current migrations; Shopify auth/hold/CAS adapters; Admin composition/service/editor/shared state; geometry/renderer paths; and relevant boundary/build/CI tests. Preserved initial and `f46535c` review dispositions were inspected.

| Brief sections | Disposition |
|---|---|
| 1–3: hold/admission | Production-owned admission and same-mode path inspected; settlement finding remains |
| 4–5: evidence/release | Atomic immutable evidence inspected; synthetic release premises confer no release authority |
| 6–7: coordinator/recovery | Claim ownership, crash/race paths and audited recovery inspected; finding remains |
| 8–9: Admin/history | Truthful terminal/reinstall/recovery reads inspected; current query bindings verified |
| 10–13: restrictions/tests/roles/review | Restrictions observed; retained failures preserved; identified regression gap |
| 14–16: acceptance/exclusions/handoff | Material issue remains; principal review boundary preserved |

No additional material lock-order inversion, public lower-level activation bypass, immutable-record defect or unsafe protocol/product assumption emerged.

**Executed independently:** Git/source/hash checks; two focused Admin test files, both passing; database compilation and three query-seam emits entirely in memory, with zero diagnostics and exact built-artifact matches; the synthetic reproducer above. All commands exited 0.

**Inspected receipts, not rerun:** root passes including application 171 and Shopify 203; PostgreSQL 89; HTTP 16; worker 15; stress 100/100 without retries; expected renderer-negative control; fixture strict compilation and migration down/up. All 54 registered sanitized log hashes and six query-artifact bindings match. The 100,001-operation pointer/fallback/Admin plans use the intended indexes; structural recovery fixtures establish no real operator decisions.

No delegation, edits, network/provider/browser/build execution, credential reads or database operations occurred. Explicit limitations remain: no real all-channel or in-flight proof; synthetic status transport has no native atomic CAS; no production release source or genuine `RELEASE_BOUND` record; no production recovery authority wired; `DEV_PREVIEW_OBSERVED` remains unqualified. **No M5 or gate pass is established.**