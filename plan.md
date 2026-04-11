# Plan: Insignia — Production-Ready State

## Context
Bring the Insignia Shopify app to production-ready state by fixing code gaps, completing Docker deployment infrastructure, reconciling spec/code drift, and updating documentation. Research phase already complete inline (upload flow confirmed as server-side multipart — spec needs updating, not code).

## Acceptance criteria
- [x] `app/shopify.server.ts` uses `ApiVersion.April26` on both lines
- [x] `apps.insignia.cart-confirm.tsx` calls `checkRateLimit(shop.id)` after shop lookup
- [x] All `apps.insignia.*` storefront routes handle `OPTIONS` preflight with correct CORS headers
- [x] New Prisma migration adds Postgres BEFORE UPDATE trigger on `OrderLineCustomization`
- [x] `docs/core/api-contracts/storefront.md` documents server-side multipart upload (not presigned URL)
- [x] `docker-compose.yml` has `app` service with healthcheck dependency, env_file, port 3000, restart policy
- [x] `.dockerignore` excludes `.env`, `node_modules`, `.react-router`, `.shopify`, `.claude`, `*.log`
- [x] `SETUP.md` has "Storage" and "Production Deployment" sections
- [x] Plan tracking files have completed tasks marked
- [x] `docs/notes/open-work.md` "Customer artwork upload page" item closed
- [x] `AUDIT.md` and `docs/STATE_AUDIT.md` are identical
- [x] `npm run typecheck` and `npm run lint` pass

## Steps

### Phase 1 — Code fixes (parallel batch A)
1. [implementer] Fix API version in `app/shopify.server.ts` lines 13 and 28: `ApiVersion.October25` → `ApiVersion.April26`
2. [implementer] Add `checkRateLimit(shop.id)` to `app/routes/apps.insignia.cart-confirm.tsx` after shop lookup (follow prepare.tsx pattern)

### Phase 2 — CORS OPTIONS preflight (all storefront routes)
3. [implementer] Add OPTIONS handling to all `app/routes/apps.insignia.*.tsx` resource routes:
   - `config.tsx` (loader-only GET): add action export that handles OPTIONS returning 204 with CORS headers, 405 otherwise
   - `prepare.tsx`, `cart-confirm.tsx`, `customizations.tsx`, `price.tsx`, `uploads.tsx` (action POST): add OPTIONS check at top of action before method check
   - Headers to return: `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers: Content-Type`
   - Origin handling: mirror the `Access-Control-Allow-Origin` approach (use shop domain from proxy auth, or wildcard for pre-auth OPTIONS)

### Phase 3 — DB trigger migration
4. [implementer] Create Prisma migration with raw SQL for geometry snapshot immutability:
   ```
   npx prisma migrate dev --name add_geometry_snapshot_immutability_trigger
   ```
   Write the SQL from AUDIT.md §6 into the migration file directly (raw SQL in migration.sql).

### Phase 4 — Upload spec reconciliation
5. [implementer] Update `docs/core/api-contracts/storefront.md` to document the server-side multipart upload flow (modal POSTs `multipart/form-data` with `file` field → server uploads to R2, returns `{ logoAsset }`). Remove or mark as deprecated the presigned-URL flow description.

### Phase 5 — Docker/deployment (parallel batch B)
6. [implementer] Complete `docker-compose.yml`: add `app` service (builds from Dockerfile, depends_on db with condition service_healthy, env_file: .env, ports: 3000:3000, restart: unless-stopped)
7. [implementer] Expand `.dockerignore` to exclude: `.env`, `node_modules`, `.react-router`, `.shopify`, `.claude`, `*.log`, `prisma/migrations/*.sql` (keep schema), `public/`? (keep), `.git`, `.github`
8. [implementer] Add "Storage (Cloudflare R2)" and "Production Deployment" sections to `SETUP.md`

### Phase 6 — Docs and tracking cleanup
9. [implementer] Mark completed tasks in both plan files; close stale item in `open-work.md`; sync `AUDIT.md` → `docs/STATE_AUDIT.md`; update AUDIT.md to mark resolved issues

### Phase 7 — Verification
10. [tester] Run `npm run typecheck` and `npm run lint` — both must pass
11. [reviewer] Review security-sensitive changes: CORS headers, rate-limit addition, DB migration SQL

## Risk assessment
- Risk: Prisma migration with raw SQL trigger | Mitigation: SQL is fully specified in AUDIT.md §6, non-destructive (only prevents overwrites), applied via `migrate dev` on dev DB first
- Risk: OPTIONS handling may interfere with React Router routing | Mitigation: Check method before authentication (no auth needed for pre-flight)
- Risk: `ApiVersion.April26` enum may not exist in installed SDK version | Mitigation: Check SDK version first; fallback to string `"2026-04"` if enum missing
- Risk: docker-compose app service needs correct `docker-start` script to exist | Mitigation: Confirmed in package.json: `"docker-start": "npm run setup && npm run start"`
