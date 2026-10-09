# Production actions and owner inputs — separately gated

## Already closed

PR54's M5-023 one read-only lifecycle observation is **closed**. The owner-restricted temporary key is reported revoked, no residual authenticated access granted. It found no qualified observed worker or queue. Do not reuse old key files, revive historical execution or retry the M5-023 live flow.

## New M5-024 authorization in this handoff

Permits repository reads, branch/PR and local isolated build/test/migration rehearsals, synthetic credentials, operator drafting and review. Does **not** authorize renewed SSH, changing DB schema/roles, enabling a worker, upgrading queue, deploying a web image, live backup, site restart, owner Search, Shopify app/provider operations or fixture.

A live plan must separately establish:

1. Exact owner-approved host/access scope, temporary key/fingerprint and resource ceilings.
2. Current read-only processor topology/DBA/Compose/secret-parity observation (no global assumptions).
3. Frozen source/build/worker/queue/schema/role/operator hashes, two fresh completed-source reviews and exact-head CI.
4. Restricted schema installation/role provisioning operation **only if individually authorized**, with private durable backup, no unreviewed pg-boss runtime auto-migration.
5. Health and processing qualification including real queue/schema role readback, safe ingress/consumer and surrounding unrelated services.
6. Access revocation and stop-on-ambiguous-action settlement.

If owner supplies no access/config, return `BLOCKED_OWNER_RESOURCE_AUTHORIZATION` at live boundary. If existing worker is outside reviewed inspectable topology, return `BLOCKED_UNKNOWN_EXISTING_PROCESSOR_TOPOLOGY` until diagnosed; do not deploy another by assumption.

## M5-023 original work still gated behind this

Only after independently qualified uninstall processor/queue and new permission may another reviewed plan take private backup → migration16/trusted roles → corrected **web-only** deploy → one normal-browser Search → current technical readiness/trusted Active1158986629121 evidence bound by exact original30-second observations → legitimate owner-backed commercial entitlement → at most one disposable G7 publication fixture. No direct jump to these steps, no Shopify app version release/rollback/scope change, and no merchant rollout.
