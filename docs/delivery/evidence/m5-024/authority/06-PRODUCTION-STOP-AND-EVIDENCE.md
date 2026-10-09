# M5-023 production stop — immutable evidence summary

**Actual classification:** `BLOCKED_UNINSTALL_PROCESSOR_READINESS / M5_G7_NOT_PASSED`. Initial owner-authorized host lifecycle qualification was a *read-only* step after frozen preproduction gate. Its receipt is committed under `docs/delivery/evidence/m5-023/lifecycle-settled.json`, and summarized at `receipts/lifecycle-settled.json` here. **Do not retroactively upgrade unknowns or NOT_RUN checks into PASS/FAIL.**

## Observed, not guessed

| Premise | Bounded finding |
|---|---|
| Running Docker worker | Zero candidate matches within observed Docker topology; **not** global proof of absence |
| Dedicated pg-boss queue | No `pgboss` schema in designated PG18 database, queue unusable |
| DBA session | Correct designated socket/database/user/public relation; qualified |
| Runtime/application rights | Role/application privilege checks qualified; worker-specific live sessions **NOT_RUN** |
| Webhook-secret/client-secret parity | Comparison false; exact field cause deliberately not claimed |
| Candidate web/runtime configuration parity | False; digest retained; exact drift field unknown |
| Worker artifact/health/keys/endpoints | **NOT_RUN** due to missing qualifying candidate |
| Existing web | Healthy old M5-019 image `sha256:8aa439cb733160ce6b99165e8401cfbc60f612851aeef0d76735db92917dc3f5` |

Receipt time: `2026-10-08T20:16:44.643051+00:00`. Host metadata is bounded to observed containers, not a complete host process proof.

## Closed mutation accounting

- One read-only lifecycle observation; two read-only DBA transactions.
- Zero task-authorized database writes, backup attempts, migration16, role provisioning, web/worker deployment, restart, provider/Shopify requests, owner Search, trusted append, product/fixture and cleanup actions.
- Six authenticated SSH command connections and two denied post-key-removal verification connections as supplied accounting.
- Temporary key line removal acknowledged, other key lines preserved, subsequent auth denied, local private key removed. Initial verification harness's overly exact response-string assertion failed and was preserved; access removal was not retried or bypassed.
- No unresolved task-authorized database/provider mutation.

**Source of truth:** GitHub PR54 current head `docs/delivery/M5-023-REPORT.md`, `docs/delivery/evidence/m5-023/lifecycle-settled.json`, `host-readonly-outcome.json`, `closed-accounting.json`, `access-closure.json`, `M5-023-G7-MATRIX.md`, `M5-023-UNINSTALL-PROCESSOR-PROPOSAL.md` and the final qualification comment. These remain immutable historical facts after merge.

## Decision for successor

Do not treat the missing queue as permission to run pg-boss's automatic schema creation against production with a broad runtime role. It is a new controlled deployment/role/schema prerequisite under separate resource authority. If an independent current worker shape exists, qualify its true executable, queue and route first. Otherwise prepare the pinned M3 worker/pg-boss and least-privilege steady-state operator schema offline, with exact source/version/operator tests.
