CHANGES_REQUESTED

PR54 review binds only head `8c595b228cbe244cae6058719c28cf6ce0132e32`. Base, tree and clean working state match the supplied pins.

- **P1 — Uninstall lost before inactive-generation reinstall.** [shopify-webhooks.ts:172](/home/serveradmin/insignia-m5-023-worktree/packages/database/src/repositories/shopify-webhooks.ts:172): A is already inactive; provider observations confirm B; B’s signed uninstall is processed before B persists. Processing permanently completes it as stale, while unchanged inactive-A state permits B’s installation transaction. Removed B becomes active. Preserve overlapping uninstall evidence and transactionally fence creation against it. Add this ordering; the supplied reinstall test processes after commit.

- **P1 — Rebinding decision precedes the shop lock.** [shopify-webhooks.ts:138](/home/serveradmin/insignia-m5-023-worktree/packages/database/src/repositories/shopify-webhooks.ts:138): while B’s reinstall transaction holds the shop lock, processing reads committed active A and returns resolved A. Deactivation then waits; after B commits, its generation comparison fails and permanently completes the delivery as stale. A post-observation uninstall therefore never reaches B. Acquire the shop lock before every resolution decision, or re-resolve after failed comparison; add a barrier regression.

- **P1 — Qualification checks the wrong role and omits application rights.** [host-operator.py:152](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/host-operator.py:152) checks queue privileges for hardcoded `insignia_runtime`, although candidate matching ignores login identity. A worker using another role can register handlers and pass `/ready` while lacking uninstall-table permissions. This falsely permits subsequent mutation. Qualify actual web/worker logins’ required queue and application privileges read-only; add an underprivileged-worker rejection control.

- **P1 — “Exact worker” excludes executable dependencies.** [host-operator.py:140](/home/serveradmin/insignia-m5-023-worktree/docs/delivery/evidence/m5-023/operators/host-operator.py:140) hashes only unchanged `main.js`/`handlers.js`. An older worker with those identical files and stale `@insignia/database` passes, despite lacking corrected uninstall rebinding. Verify the immutable executable dependency inventory, including database code, before qualification. Reject mismatches without deploying a worker.

Round-one Compose correction resolves its finding; uninstall fencing and processor qualification remain incomplete.

Static coverage included full interacting authority/authentication, tenant/transactions/migrations, uninstall/credentials, readiness/release/activation/recovery, offline consumers, packaging/operators and historical host references; both preserved reviews/settings and responses were assessed.

Parent-executed results—including PG192/192, web86, concurrency, runtime and operator controls—remain supplied evidence. I executed no tests/builds/imports or live operations. Preserved failures remain failures; fresh CI is unverified here. No principal approval, production-readiness claim or merge authorization.