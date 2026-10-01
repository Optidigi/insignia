One unresolved material finding: **P2 — final readiness can use the previous merchant day.**

At [activation.ts:259](/home/serveradmin/insignia-m5-003-worktree/packages/application/src/publication/activation.ts:259), `decisionReady` derives `acceptedDay` from one clock read, then obtains `decisionAt` from another. Activation and restoration therefore can pass key readiness using yesterday’s offer window.

**Invariant:** the selected key must cover merchant day D through D+2 at the final decision timestamp.

**Executed reproducer:** using the current source and fixture entirely in memory, set UTC time to `2026-10-01T23:59:59.999Z`, key `lastDay` to `20729`, and advance only the eighth clock read by 1 ms. Use a pure timestamp-to-day converter and otherwise fresh synthetic prerequisites. The coordinator returns `ACTIVE`, recording `2026-10-02T00:00:00.000Z`; that day requires key coverage through `20730`. The injected `RELEASE_BOUND` premise is synthetic.

**Necessary correction:** capture `decisionAt` once, then derive `acceptedDay` from that timestamp and use it throughout the final checks. Add regression coverage for activation and the shared restoration check. Quote issuance retains its independent guard.

No other unresolved material Standards/security finding was identified. Source inspection supports the committed restoration claim’s invocation ownership, observer-only recovery of claimed writes, and the locked, audited-history publication path. The prior findings and security dispositions remain preserved.

Reviewed identity:

- Base/effective merge base: `8a84ddeaf277368852d224915abe6d4a93a3d8a4`
- HEAD: `1e2765fe200b43b7f4aa2535da3cebfafbb58031`
- Tree: `876c70965ced86c18dd0c11bedd3456aef18f1e0`
- Branch: `feat/m5-003-activation-admission`
- Worktree clean before and after review. Cached remote branch matches HEAD; cached `origin/main` matches base. No fetch occurred.

I inspected the complete new/changed executable source and tests plus interacting application publication/key/artifact/readiness code; database facade, repositories and all current migrations; Shopify authentication, hold, ownership and CAS adapters; web admin composition/service/editor/shared state; geometry/renderer paths; and relevant package, boundary, CI and build/browser tests. Required authority documents, historical approvals, preserved reviews and sanitized receipts were also read.

**Independently executed:** Git identity/diff/cleanliness checks; application/database/Shopify TypeScript checks with `--noEmit --incremental false`; two focused admin pure-test files; secret/fixture provenance and historical-preservation checks; receipt hash audits and six query-artifact bindings. These passed. The in-memory midnight probe demonstrated the finding.

**Inspected receipts, not rerun:** final root checks, application 171, Shopify 203, PostgreSQL 89, HTTP 16, worker 15, stress 100/100 without retries, strict fixture compilation, migration down/up and query measurements. Initial and intermediate failures remain recorded.

Explicit limitations remain: no real all-channel/in-flight proof; the status adapter has no native atomic CAS; no production release source or real `RELEASE_BOUND` record; no wired production recovery authority; structural recovery fixtures do not establish operator decisions; `DEV_PREVIEW_OBSERVED` remains unqualified; no M5 or gate pass.

This is an independent local review, not principal approval or gate adjudication. No delegation, edits, credential reads, DB, browser, build, network or provider operations were performed.