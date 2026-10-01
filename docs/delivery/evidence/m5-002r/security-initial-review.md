> This review predates the newly observed CI and 39/40 stress failures. It is not a final disposition of those failures.

**SOURCE: no unresolved material Standards/security finding. LIVE: BLOCKED_EVIDENCE.** This is a local review, not principal approval or gate adjudication.

Verified at start and finish:

- Head: `0e946ab8ad04b74d90618da0aaf6f43b4551b9d6`
- Tree: `404bb4f95a484b21708b3448a1ee8f3056e5a57e`
- Base/effective merge base: `28e69864ebb9796504861a541363880cc86a82f8`
- Clean tracked worktree; source unchanged from accepted baseline `0b08c033d7a5609e2cfde219d5b76d4822d29723`.

Full M5-002 source/tests/scripts and interacting authentication, persistence, renderer and readiness paths preserve the supported trust model. No CSP weakening or production activation path was introduced.

Material evidence blockers:

- **P1 — Exact restoration ambiguous:** [cleanup-receipt.json:15](https://github.com/Optidigi/insignia/blob/0e946ab8ad04b74d90618da0aaf6f43b4551b9d6/docs/delivery/evidence/m5-002r/cleanup-receipt.json#L15) records **empty pre-grants versus nine post-grants**, with identical app/shop/installation. Clean exited 0 and no-preview/example.com was observed, but exact released-version resource was not independently reread after the discrepancy. Cause remains unestablished.
- **P1 — Function binding unavailable:** [owned-function-observation.json:15](https://github.com/Optidigi/insignia/blob/0e946ab8ad04b74d90618da0aaf6f43b4551b9d6/docs/delivery/evidence/m5-002r/owned-function-observation.json#L15) contains null Transform and Validation identities. No actual development attestation was constructed; CLI build hashes cannot replace provider identity evidence.
- **P1 — Live qualification incomplete:** [M5-002R-REPORT.md:38](https://github.com/Optidigi/insignia/blob/0e946ab8ad04b74d90618da0aaf6f43b4551b9d6/docs/delivery/M5-002R-REPORT.md#L38) preserves unfinished deep/reload, save/CAS/exact replay and component/browser proof. Hydrated authenticated list/detail and local draft v1 create/open are bounded observations.

Accounting reconciles to **15 reads and six auth attempts/reservations**: two diagnostic exchanges plus four opaque CLI reservations. The outer guard checks exhaustion and writes/fsyncs before underlying requests. Two additional legacy inner reservations were blocked before sending. Recorded Partner/mutation/event counts remain zero; CLI internals remain opaque.

**Executed:** read-only Git/source inspection, Python manifest/accounting/hash checks, and four pure current-source attestation assertions—all passed. Full `git diff --check` exited 2 for receipt whitespace; excluding evidence files passed.

**Inspected, not rerun:** six operator/runtime tests, 58 attestation tests, root/PG/40-case stress and history/secrets logs. These remain local evidence. Current-head CI was not independently verified. No network/browser calls, credential reads, writes, DB mutations or delegation occurred.