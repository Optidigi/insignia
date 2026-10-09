# M5-024 test and threat matrix — local qualification

All tests use synthetic identities/secrets/fixtures and designated isolated PostgreSQL18 databases. Define expectations before a probe; retain expected RED behavior and GREEN corrections. Never send a real Shopify uninstall/reinstall or touch production under this authorization.

| Category | Required isolated cases / acceptance |
|---|---|
| Worker entry & identity | Exact packaged Node/executable and module graph, pinned versions, direct PID1, 127.0.0.1 `/ready` real queue check, clean SIGTERM/restart, read-only root, no new privileges/caps/mutable code mounts |
| Existing vs missing worker | Current topology discovered only from bounded receipts; alternate deployment shape remains UNKNOWN until read-only owner-authorized confirmation; wrong-image/mount/launcher rejected |
| Queue installation | Pinned pg-boss12.35.0, PG18 target/schema/version; installer and steady-state runtime privileges separated; idempotent create/upgrade, missing/mismatched schema fails, no runtime implicit unreviewed DDL |
| Queue privileges | Real web enqueuer rights, worker lease/consume/ack/maintenance rights, designated DB endpoint, actual PUBLIC privileges revoked, missing exact function/schema grants fail; unnecessary schema/role CREATE denied |
| Ingress and handoff | Raw signed body HMAC valid/invalid, wrong domain/id, duplicate deliveries, acknowledged durable inbox commit then queue, exactly-once delivery ID admission, failure between inbox and `send`, delayed recovery |
| Uninstall concurrency | First-session wait, current vs historical trigger, uninstall while provider IO runs, reinstall race, stale generations, signed Shop identity mismatch, processed receipt identity stability, duplicate and future-delayed delivery |
| Worker crash/replay | Crash after queued before receipt, after lease before DB transaction, after generation deactivation before ack, recover once with idempotency; retry never revives stale generation |
| Credential lifecycle | Current and previous wrapping keys, missing key/invalid envelope, old-generation refresh no longer usable; no offline background token invented; exclude provider requests in local tests |
| Secret parity | `SHOPIFY_WEBHOOK_SECRET` / `SHOPIFY_CLIENT_SECRET` equality as required by reviewed deployment, previous secret rotation semantics, secret absent/mismatch, sanitized error reporting; never print values |
| Compose/DNS/config | Candidate/source byte drift, inherited env interpolation, extra mounts/networks/host aliases/security opts/ports, local DB routing/libpq overrides, adjacent unrelated services unchanged |
| Rollback | Revert only worker/web image under reviewed authorization, preserve app inbox and pg-boss jobs/migrations, no automatic down/DELETE/CASCADE, no ambiguous mutation retries |
| Security research case | Reuse captured **valid signed body** with altered `X-Shopify-Triggered-At`, shop-domain and delivery-ID metadata in fully isolated ingress; determine if header trust can revive or deactivate a wrong generation. HMAC is of raw body, not full headers. Treat as *candidate threat*, not pre-labelled exploit; investigate realistic delivery/transport capabilities and principal-approved smallest mitigation if reproduced |

If any relevant case cannot be run offline because it truly requires current host shape/provider access, mark **BLOCKED/NOT_RUN** with exact evidence need and stop at the offline review boundary. CI green is never native G7 PASS.
