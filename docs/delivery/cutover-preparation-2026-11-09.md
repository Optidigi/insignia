# Complete cutover preparation

This procedure stops before final production cutover and rollout. Use the [verified development baseline and open gates](precutover-handoff-2026-11-09.md) as reference. The shared SSH host alias `prod` also runs unrelated applications; the named rewrite services are development resources.

1. Close each applicable owner gate in the handoff. Obtain exact production resources and maintenance scope through private custody. Keep customer dispatch and unqualified currencies disabled. Obtain a production signing-horizon decision rather than copying the development-only 31-day policy.
2. Freeze the approved source, CI attempts, OCI tar digests, loaded immutable images, native modules and complete version inventory. Re-read actual installation, scopes, schema, grants and consumer endpoints. Reject drift instead of widening a closed profile. Preserve all historical profiles and NEVER_RELEASE versions.
3. Qualify complete recovery before exposure. Include the database, private artwork and preview bytes, exclusions, expiry replay and independent recovery-key custody. Measure RPO 24h/RTO 4h. Preserve current keys, accepted/uncertain commands, decline markers and financial facts. A pre-rotation snapshot cannot overwrite later authority.
4. Rehearse the exact credential/storage transition across web, worker, inspector, verifier, backup and monitoring consumers. Use the [credential procedure](../../deployment/m5-runtime/README.md#credential-rotation-procedure) and [backup procedure](../../deployment/backup/README.md). Keep private environment/configuration out of rendered logs, chat and Git.
5. Account for in-flight operations and actual deadlines. Drain every eligible acceptance writer before an incompatible writer transition. Include the inspector in any full database/object checkpoint exclusion. Preserve the existing PENDING application unless its exact operation can be reconciled. Never infer settlement from a missing row or an empty different cart.
6. Prepare and compare actual replacement Compose models. Change only qualified pins/selectors and separately allocated resource settings. Preserve routes, networks, mounts, permissions, resource limits and permanent verifier custody. Stop the old receiver and reconcile its journals before starting one replacement. Do not remove a socket or journal to force startup.
7. Apply only reviewed, missing migrations and exact column grants within the allocated scope. Preserve schema 52 decline invariants. Do not use schema rollback or an old acceptance writer after terminal authority exists.
8. Stage any changed theme graph as a new inactive version with preserved native registration identities and qualified Function pins. Independently freeze its real binding and complete inventory. Qualify matching consumer/verifier artifacts before the separately allocated single release. Reconcile an ambiguous release before any retry. Backend-only changes need no extra Shopify version when theme bytes are proved identical.
9. Obtain fresh correlated independent release evidence through the maintained mechanism. Verify current installation, Function ownership, public configuration, signing window and each consumer's own read. Expired receipts are historical evidence. A quiesced role probe does not establish running-worker purchase processing.
10. Exercise the specifically allocated native UI and quote/cart flows, account for owned lines and read back exact cleanup. Preserve original operation identity on unknown outcomes. A new checkout/order/payment needs its own allocation; the earlier one-order budget is consumed.
11. Verify production startup/recovery under an allocated shared-host window. Include database, inspector and the exclusive verifier receiver. Resolve the current verifier `restart: no` policy before claiming unattended reboot recovery. Keep unrelated applications unchanged.
12. Stop at the prepared, reviewed checkpoint. Record remaining failures and owner decisions. Do not switch final production traffic, enable customer dispatch or start merchant rollout without the owner's separate authorization.

## Stop and recovery conditions

Stop on identity, scope, inventory, grant, image, mount or protected-fact drift. Stop on an unknown stop/start/provider outcome, unresolved append, failed readiness or expiry. Reconcile the original journal before another effect. Keep the last verified immutable artifacts and exact private configuration available.

After new keys, accepted commands or terminal declines exist, use compatible schema 52 recovery or fix-forward. Preserve dates, epochs, financial history and operation identity. Do not restore a stale database, drop a volume, reactivate a consumed owner allocation or restamp an expired attestation.

## Maintain the current development deployment

These commands apply only to a later authorized repair of the existing rewrite development services. Confirm database readiness, image/profile compatibility and receiver/socket ownership first. Use the private canonical management files. Do not render their environment values.

```sh
docker compose -p insignia-release-verifier -f /home/serveradmin/.local/share/insignia/runtime/verifier.private.json start verifier
docker compose -p insignia-rewrite-m5-019 -f /home/serveradmin/.local/share/insignia/runtime/web.private.json start web
docker compose -p insignia-uninstall-m5-024 -f /home/serveradmin/.local/share/insignia/runtime/worker.private.json start worker
systemctl --user start insignia-artwork-inspection.service
```

Check actual image IDs, health, inspector readiness and the exclusive receiver socket afterward. Then obtain fresh independent admission through the [runtime runbook](../../deployment/m5-runtime/README.md). The database service is not recreated by these commands. Do not run `down -v` or a blind mutation retry.
