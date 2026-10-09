# M5-024 criterion matrix

All new behavioral checks use synthetic identities and the isolated local PG18.6 cluster at loopback55426. No provider transport is used to establish queue or uninstall behavior. Full source/command/hash receipts are in the [evidence manifest](evidence/m5-024/local-checks.json); earlier failures are retained with their original verdicts.

| Required criterion | Local executed evidence | Classification / limit |
| --- | --- | --- |
| Exact worker/graph/pins | Offline portable build, complete inventory, fresh actual main process | PASS portable process; container/image/PID1 NOT_RUN |
| Health/shutdown/restart | Existing runtime/health suites, portable process /ready,/live,SIGTERM; queue restart | PASS local; OS isolation NOT_RUN |
| Alternate processor | M5-023 stopped receipt observed zero matching running Docker candidates | UNKNOWN outside that bounded observation; fresh authorized host discovery required |
| Schema absent/wrong policy/version | managed-schema + queue controls, actual missing-schema RED then GREEN | PASS fail-closed; no runtime install/unknown upgrade |
| Owner/steady identities | queue-privileges actual NOLOGIN capability groups + local login users | PASS owner repeat, real producer/consumer/uninstall; current VPS role/endpoint NOT_RUN |
| PUBLIC / extra privileges | Real revoked function, schema CREATE, queue creation, version/policy rewrite, DELETE/TRUNCATE denial | PASS isolated; production memberships/ownership require requalification |
| Ingress raw HMAC/admission | Existing verifier rotation/duplicate/header controls and actual built HTTP test | PASS accepted raw-body contract; metadata replay separately BLOCKED |
| Inbox committed / enqueue lost | Existing handoff503 test + bounded recovery of a committed inbox without job | PASS local durable recovery |
| Uninstall/reinstall/provider-IO races | Full database managed-install/runtime regression; processed receipt stability | PASS existing accepted semantics; no native uninstall/reinstall experiment |
| Crash after queue/before transaction | Actual forked production queue/handler process killed after lease, before transaction | PASS restart once; synthetic SQL clock advances lease/monitor timestamps |
| Crash after deactivation/before ack | Actual forked process killed after production handler commit | PASS retry with one durable attempt/deactivation; same clock seam |
| Retry/generation fences | Actual queue retry/restart, full database credentials/managed-install suites | PASS local; no external refresh request |
| Wrapping keys/envelopes | Existing current/previous/invalid-key tests and full encrypted credential regressions | PASS local; actual private host key parity NOT_RUN |
| Webhook/client secrets + previous rotation | Pure guards compare private inputs without output; verifier current/previous ring controls | PASS synthetic controls; real parity UNKNOWN |
| Compose/source/image/mount/DNS/env drift | Pure guard negatives + existing read-only inventory controls | PASS supplied synthetic observations; actual host rendering/DNS/network NOT_RUN |
| Rollback/messages | Owner idempotent repeat preserves completed job bytes; unknown version rejects; local worker restart | PASS message preservation; live backup/image rollback NOT_RUN |
| Captured body, altered unsigned ID/time | Real HTTP + production worker characterization, unchanged original signature | REPRODUCED_LOCAL / BLOCKED_WEBHOOK_METADATA_SECURITY_BOUNDARY; no claim of production capture capability |
| Full regression | Root check, PG18 database, worker, real HTTP, stress and renderer commands | Results individually recorded, with deliberate no-DB skips separated from DB runs |
| Fresh reviews/natural CI | Exact-head full-source reviews and attempt1 natural workflows attached to PR | Principal review remains required; no successor merge |
