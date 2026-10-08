# M5-022R — same-PR trusted-evidence migration correction

## Scope
Correct only PR #53. No production/provider/browser/VPS/database provisioning operation.

## Migration16 fail-closed down semantics
`packages/database/migrations/20261008000100_m5_trusted_release.sql` must refuse down migration whenever `trusted_release_records` contains any row.

Use a fail-closed pre-drop guard before `DROP TABLE`.

Do not delete/truncate records to permit rollback.

## PostgreSQL regressions

### Empty
- migrate up;
- relation exists;
- migrate down while empty => succeeds;
- migrate up again => succeeds.

### Non-empty
- migrate up;
- create prerequisite shop/install;
- insert one valid trusted release record;
- attempt down;
- expect failure;
- record still exists exactly;
- table still exists;
- UPDATE fails;
- DELETE fails;
- TRUNCATE fails.

If migrations run transactionally, prove failed down leaves every object intact.

## Preserve trust model
Do not change append-only semantics, runtime SELECT-only rule, 30s freshness, current-Active binding, build parsing, evidence digest, attestation scope, activation semantics, auth retry semantics, or v1/v2/v3 behavior.

## Provisioning-proposal amendment
Update M5-022 provisioning proposal:
- no one-off SQL tenant seed;
- zero tenant row reveals missing public-app first-install bootstrap;
- successor must implement managed-install/token-exchange bootstrap through reviewed tenant lifecycle;
- provider shop/install IDs authoritative, browser IDs not;
- concurrent first requests safe/idempotent;
- reinstall advances generation through reviewed lifecycle;
- evaluate expiring-offline credential acquisition/persistence through existing M3 encrypted lifecycle when background work requires it.

Commercial values remain owner-controlled. Do not invent them.

## Validation
Run focused migration tests, PostgreSQL18, full regression, naturally applicable CI, and two fresh final-head GPT-6.1-sol/high reviews.

Return SAME PR #53 and stop. No production activity.
