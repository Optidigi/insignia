# Stitchs migration runbook — placement-method pricing cleanup

**Target shop:** `stitchs-nl.myshopify.com`
**Target shopId:** `e300bab6-d980-4ec2-9ef2-1067d181aaab`
**DB / stack:** `insignia-custom`
**Deploy path on VPS:** `/srv/saas/infra/stacks/insignia-custom/`

This runbook pairs with [`stitchs-placement-method-bulk-write.sql`](./stitchs-placement-method-bulk-write.sql) and covers:
1. What changes on deploy (Prisma side).
2. What the operator runs on the VPS, in order.
3. How to roll back.
4. How to verify post-write.

---

## 1. What the Docker deploy does automatically

The image built from `main` contains Prisma migration `20260426000000_drop_placement_step_method_price`. On `docker compose up -d`, the app container's entrypoint runs `prisma migrate deploy` before starting the web server, which:

- **Drops** `PlacementStepMethodPrice` (and all Stitchs "Groot +750" overrides in it — acceptable, see rollback section).
- **Keeps** `PlacementDefinitionMethodPrice` (added in `20260425000000_add_placement_method_price`), which is the table we populate in the SQL script.

No Prisma code manipulates data — the migration is pure schema. Business-data fixes (zeroing old columns, inserting new overrides) are the SQL script's job.

---

## 2. Deploy steps on the VPS

Run from `/srv/saas/infra/stacks/insignia-custom/`. Replace `$DB_USER` / `$DB_NAME` with values from your `.env` (typically `insignia` / `insignia`).

### 2.1 Back up the affected tables

Scope the dump to the four tables this work touches, so recovery is fast.

```bash
cd /srv/saas/infra/stacks/insignia-custom/

mkdir -p backups/stitchs-placement-method

docker compose exec -T db pg_dump \
  -U "$DB_USER" -d "$DB_NAME" \
  --data-only \
  --table='"DecorationMethod"' \
  --table='"PlacementDefinition"' \
  --table='"PlacementStep"' \
  --table='"PlacementStepMethodPrice"' \
  --table='"PlacementDefinitionMethodPrice"' \
  > backups/stitchs-placement-method/pre-migration-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Verify the dump is non-empty (`ls -lh backups/stitchs-placement-method/`).

Note: `PlacementDefinitionMethodPrice` may not exist on the OLD image yet (it was added by `20260425000000_add_placement_method_price`). If `pg_dump` errors because the table is missing, drop that `--table='"PlacementDefinitionMethodPrice"'` line and re-run — the other four cover rollback fully.

### 2.2 Pull the new image

```bash
docker compose pull app
```

(Adjust service name if it's not `app` in your compose file.)

### 2.3 Restart — triggers `prisma migrate deploy` automatically

```bash
docker compose up -d
```

Wait a few seconds for the entrypoint to finish. Tail logs to confirm migration ran cleanly:

```bash
docker compose logs -f --tail=200 app | grep -i -E 'prisma|migrat'
```

You should see both `20260425000000_add_placement_method_price` and `20260426000000_drop_placement_step_method_price` applied (or already applied).

### 2.4 Confirm migration status is clean

```bash
docker compose exec -T app npx prisma migrate status
```

Expected: `Database schema is up to date!` (or equivalent).

### 2.5 Run the bulk-write SQL script

Copy the SQL file into the container, or pipe it via stdin:

```bash
docker compose exec -T db psql \
  -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 \
  < ./scripts/stitchs-placement-method-bulk-write.sql
```

`ON_ERROR_STOP=1` guarantees that if the guard block (or any statement) raises, psql exits non-zero and nothing after the `BEGIN;` was committed.

Expected console notices:
- `Guard passed: shop=e300... methods=2 products=7 placements=28 steps=56`
- `Post-write verification: 56 override rows present (expected 56)`
- `COMMIT`

If the guard aborts, see section 2.6 before retrying.

### 2.6 If the guard aborts

The script aborts *before any writes* when the fixture counts don't match. Re-check:

- The Stitchs shop still has 2 methods named `Borduren` and `Bedrukken` (exact case, no trailing whitespace).
- The 7 ProductConfigs each still have the 4 expected placement names: `Linkerborst`, `Rechterborst`, `Linker Schouder`, `Rug`.
- Each placement has exactly 2 steps.

Do a read-only diagnostic:

```bash
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -c "
  SELECT pc.name AS product, pd.name AS placement, COUNT(ps.id) AS steps
  FROM \"ProductConfig\" pc
  JOIN \"ProductView\" pv ON pv.\"productConfigId\" = pc.id
  JOIN \"PlacementDefinition\" pd ON pd.\"productViewId\" = pv.id
  LEFT JOIN \"PlacementStep\" ps ON ps.\"placementDefinitionId\" = pd.id
  WHERE pc.\"shopId\" = 'e300bab6-d980-4ec2-9ef2-1067d181aaab'
  GROUP BY pc.name, pd.name
  ORDER BY pc.name, pd.name;
"
```

Fix any data drift via the admin UI (don't hand-edit via SQL unless you know what you're doing), then re-run the script. The script is idempotent — re-runs are safe.

### 2.7 Verification queries

Run the post-commit queries from the bottom of `stitchs-placement-method-bulk-write.sql` (A, B, C). Expected:

- **Query A** (effective fee per product × placement × method × step): every row's `effective_fee_cents` equals the target per the pricelist:

  | placement | Borduren | Bedrukken |
  |---|---:|---:|
  | Linkerborst | 1500 | 750 |
  | Rechterborst | 1500 | 750 |
  | Linker Schouder | 1500 | 1000 |
  | Rug | 3000 | 1500 |

  (both Klein and Groot steps should produce the same number — step adjustments are 0.)

- **Query B** (missing overrides): 0 rows.

- **Query C** (orphan overrides): 0 rows. FK constraints should prevent orphans from existing, but this double-checks.

---

## 3. Rollback plan

### 3.1 If the SQL script fails mid-way

The script is wrapped in a single `BEGIN;`/`COMMIT;`, and `psql -v ON_ERROR_STOP=1` aborts on the first error. **If you see any error before the `COMMIT` notice, no rows were changed — nothing to roll back.** Diagnose, fix, and re-run.

### 3.2 If the SQL committed but produced wrong data

Restore the four tables from the pg_dump taken in step 2.1:

```bash
# 1. TRUNCATE the affected tables so the restore reinserts cleanly.
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -c '
  TRUNCATE "PlacementDefinitionMethodPrice",
           "PlacementStep",
           "PlacementDefinition",
           "DecorationMethod"
  CASCADE;
'

# 2. Reload the data-only dump.
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
  < backups/stitchs-placement-method/pre-migration-XXXXXX.sql
```

`TRUNCATE ... CASCADE` is required because those tables have FKs from each other and `ProductConfigMethod` / `CustomizationConfig` / `VariantSlot` reference `DecorationMethod`. **Be aware the cascade can wipe those dependent rows too**; if this is production you almost certainly want a full-DB `pg_restore` instead of the scoped dump. Treat the scoped dump as a "know what changed" audit trail and use a *full* nightly snapshot for real recovery.

**Recommendation:** before step 2.1, also take a full snapshot:

```bash
docker compose exec -T db pg_dump -U "$DB_USER" -Fc "$DB_NAME" \
  > backups/stitchs-placement-method/full-$(date -u +%Y%m%dT%H%M%SZ).dump
```

### 3.3 If the Docker image needs to be rolled back

The drop-table migration is destructive (it drops `PlacementStepMethodPrice`). Prisma does not auto-generate a down-migration. If rolling back the image alone is not enough, you will need to:

1. Redeploy the previous image SHA (`docker compose pull app:<prev-sha> && docker compose up -d`).
2. Manually recreate the `PlacementStepMethodPrice` table via the previous migration's SQL (see `prisma/migrations/20260424000000_add_placement_step_method_price/migration.sql` on the previous commit).
3. Mark that migration as applied: `npx prisma migrate resolve --applied 20260424000000_add_placement_step_method_price`.
4. Restore step-method data from the pg_dump.

**About data loss from the DROP TABLE:** the rows in `PlacementStepMethodPrice` today are the Stitchs "Groot +750 per method" overrides set by the earlier SQL bulk-write. Our new target state zeroes those step-level adjustments anyway, so **no business value is lost** by the drop. The backup covers regulatory/audit concerns but operationally the data is obsolete.

---

## 4. Summary — order of operations on the VPS

1. `cd /srv/saas/infra/stacks/insignia-custom/`
2. Full snapshot: `docker compose exec -T db pg_dump -U $DB_USER -Fc $DB_NAME > backups/.../full-<ts>.dump`
3. Scoped dump (section 2.1).
4. `docker compose pull app`
5. `docker compose up -d` → wait for Prisma migrations.
6. `docker compose logs --tail=200 app | grep -i migrat` → confirm both migrations applied.
7. `docker compose exec -T app npx prisma migrate status` → clean.
8. `docker compose exec -T db psql -U $DB_USER -d $DB_NAME -v ON_ERROR_STOP=1 < scripts/stitchs-placement-method-bulk-write.sql` → runs guard + writes + post-write verification.
9. Run verification queries A, B, C from the script comments. Spot-check storefront pricing for at least one Stitchs product (T-Shirt, Borduren, Rug → €30).

---

## 5. Flags / risks

- **Drop-table is destructive, not reversible via Prisma.** The `PlacementStepMethodPrice` table and all its rows are gone after step 5. Mitigation: full-DB pg_dump before deploy (step 2 of the summary).
- **Name-based placement matching is case-sensitive and whitespace-sensitive.** If anyone in the admin UI renamed `Linker Schouder` to `Linkerschouder` (no space) or `linker schouder` (lowercase), the guard will fail the 28-placement check. Fix via UI, then re-run. The script refuses to write partial data.
- **The guard asserts exactly 2 methods, 7 products, 28 placements, 56 steps.** If Stitchs adds an 8th product or a 3rd method through the admin UI before this script runs, the guard will block. In that case, re-evaluate target pricing with the user before editing the guard — do NOT just bump the number to silence the error.
- **Cascade semantics in rollback.** The scoped-dump restore in 3.2 uses `TRUNCATE ... CASCADE` which wipes `ProductConfigMethod`, `VariantSlot`, `CustomizationConfig` rows that FK to `DecorationMethod`. Prefer the full-DB `pg_restore` path for real recovery.
- **Idempotency confirmed.** All writes are `UPDATE ... = 0` or `INSERT ... ON CONFLICT DO UPDATE`. Re-running the full script yields the same post-state; safe after a partial network blip or operator curiosity.
- **No code touched.** This runbook assumes the drop-table migration's backend code changes (removal of `PlacementStepMethodPrice` reads in the pricing service) are already on `main` and shipped in the image pulled in step 4. Confirm with the backend agent before running.
