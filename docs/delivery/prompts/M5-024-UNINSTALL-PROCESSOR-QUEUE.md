# Principal authorization — M5-024: uninstall processor / durable queue prerequisite (OFFLINE ONLY)

## Entry and outcome

**Entry:** external principal approved PR54 at `c7bbca723179e908553b6f8e786a9b638e9bf6a8` and the owner delegates its normal merge to the local agent. M5-024 starts only after validating the actual **normal merge** and branch/main refs. One new successor branch/PR from the newly merged main, no PR54 amendment/reopen.

**Question resolved:** M5-023's first live lifecycle qualification correctly failed because it saw **zero matching running Docker candidates**, **absent `pgboss` schema**, and **unqualified webhook-secret and candidate-config parity**. Worker-dependent probes were NOT_RUN. The source bootstrap is locally qualified but undeployed. Goal is to provide the independently reviewed executable prerequisites needed to resume G7 later, not to relabel M5-023 as a live PASS.

**Bounded deliverable:** A reviewable offline worker/queue readiness implementation and exact guarded *conditional* production plan, or a documented read-only discovery/blocker if an unobserved existing processor may qualify. No live deployment under this authorization.

## Work in order — checkable completion criteria

### A. Establish the exact topology and options (read-only source + existing receipts)

Read actual `apps/worker` composition, `apps/web` queue producer, `packages/database` uninstall and credential paths, pinned `pg-boss` runtime, current Compose operator expectations and raw M5-023 stopped evidence. Determine required worker executable/dependency inventory, the trust boundary for raw-body HMAC and routing metadata, queue schema/version, roles, database endpoint, webhook-secret/client-secret parity, key envelopes and current-old-web coupling. Generate a version-pinned qualification checklist. Do not infer a source process absent globally from Docker candidateCount0. Owner-private secret names may be listed, but their **values** never leave private approved configuration.

### B. Resolve production packaging and migrations offline

Prefer existing M3 worker; keep current Node24.21.0 and `pg-boss@12.35.0` pins. Build reproducible exact worker image/package and startup/process/health contract; qualify module identity and read-only filesystem with nonprivileged execution, no added capabilities, direct reviewed launcher, no executable mounts and loopback-only health. Confirm separate worker deployment does not modify the existing canonical web/legacy services.

**Critical schema seam:** The pinned M3 worker uses `createPgBossRuntime()` whose `start()` invokes `boss.start()` and creates queues. The actual production database lacks `pgboss`. Investigate pinned v12.35.0 schema creation/migration behavior and necessary rights in real isolated PG18, rather than letting a production runtime implicitly create/upgrade schema with broad CREATE. Design reviewed owner/DBA schema installation and least-privileged steady-state web enqueue/worker consume identities (or independently prove equivalent safe behavior). Deny unqualified runtime DDL. Prove idempotent schema application and recoverable upgrade/rollback with existing messages preserved. Do **not** mix pg-boss schema DDL into unrelated dbmate migration16 or run the production SQL now.

### C. Behavioral and security qualification (local only)

Use real PostgreSQL18.6 isolated databases, process-level worker startup, actual queue version/role probes and intentional red/green controls. Matrix in `10-TEST-THREAT-MATRIX.md` is mandatory; add concrete cases discovered by source inspection. Real signed raw-body HMAC must precede inbox admission; shop/domain/install identity authority remains provider-bound. Prove crash/retry and uninstall/reinstall race behavior, pending recovery, last-writer/evidence invariants, worker unavailable/DB schema absent/incorrect role/incorrect image, secret mismatch/key rotation, new-host/Compose drift, and rollback without queue/data loss.

### D. Production plan for separate authorization

Produce one exact frozen candidate with: host topology and resource impact, reviewed app/web/worker Compose source, digest-bound image/start/module inventory, schema/role commands and expected readbacks, minimal backup/rollback with no destructive down, private secret injection/parity checks, read-only first-step requalification, current-qualification before each reserved mutation, independent post-deploy health/queue/consumer/recovery probes, access revocation, and stop classes. Existing worker alternative must qualify equally. **No VPS run under this slice's offline authority.**

### E. Reviews, source gate, PR handoff

TDD for behavioral changes. Run actual current scripts (no invented command names), full root/PG18/workers/guards as applicable, regression and negative tests, style/secrets, archive/entry/inventory checksum controls and exact natural CI. Two **new independent actual** `GPT-6.1-sol/high` Spec/correctness and Standards/security *complete-source* static reviews must CLEAR at the final reviewable head. Changes after review re-open exact-head qualification. Preserve truthful earlier failing runs. Provide short public evidence manifests with hashes, keep private raw logs/credentials segregated. Return **one PR** for external principal review; **no auto-merge**.

## Strict non-goals / decisions retained

- No Shopify CLI/browser/provider activity, Function version/release/rollback/scopes change, new app or merchant rollout.
- No manual production tenant/install row seed; no ProductConfig fixture; no owner-backed commercial fields inferred or dev-only entitlement fabricated.
- No reimplementation of bootstrap or wholesale offline credential subsystem; existing encrypted expiring-offline lifecycle remains authoritative.
- No Availability v3 reinterpretation, v1/v2 history rewrite, artifact attestation relaxation or 30-second restamp.
- No live worker, queue, schema, roles, web deploy, prod SQL, SSH/key, Search or trusted append before separately granted owner resource authority and exact reviewed live plan.
- No arbitrary editor/refactor/language-change work from the independent audit within this blocker-focused slice.

## Principal stop outcome

M5-024 offline may finish as `OFFLINE_EXECUTE_CANDIDATE_READY`, `BLOCKED_UNKNOWN_EXISTING_PROCESSOR_TOPOLOGY`, `BLOCKED_UNQUALIFIED_QUEUE_PRIVILEGES`, `BLOCKED_WEBHOOK_METADATA_SECURITY_BOUNDARY`, or another narrowly evidenced blocker. None means live G7 PASS. Stop and return the PR; later live operator permission is a **separate** owner/principal gate.
