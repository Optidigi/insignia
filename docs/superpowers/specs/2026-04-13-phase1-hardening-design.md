# Phase 1 Hardening — Design Spec

**Date**: 2026-04-13  
**Branch**: `feat/phase1-hardening`  
**Scope**: Operational hardening, observability, and merchant-facing order status controls.  
**AUDIT.md items**: §1.3, §2.2, §2.3, §2.5, §4.2, §8.1, §1.2, §3.2, §8.4 + close §4.1, §5.4

---

## 1. Cron Cleanup Endpoints (§1.3 + §2.3)

### Problem
Expired `RESERVED` and `IN_CART` variant slots are reclaimed lazily on the next prepare call.
Under load, the pool can exhaust before self-heal fires, blocking new customizations.
`CustomizationDraft` records from abandoned sessions accumulate indefinitely.

### Solution

#### Shared auth helper
`app/lib/cron-auth.server.ts`

- Reads `CRON_SECRET` from env.
- Checks `Authorization: Bearer <token>` on the incoming request.
- In development (NODE_ENV !== production) + no env var: bypassed (fail-open for dev convenience).
- In production + no env var: throws 500 at request time with a clear log message (fail-loud).
- Returns `true` or throws a `Response` (401) that the caller re-throws.

#### Route: `POST /api/admin/cron/cleanup-slots`
File: `app/routes/api.admin.cron.cleanup-slots.tsx`

Steps (all in one Prisma transaction):
1. Find all `VariantSlot` where `state = RESERVED AND reservedUntil < now()`.
2. Find all `VariantSlot` where `state = IN_CART AND inCartUntil < now()`.
3. Collect `currentConfigId` from each affected slot.
4. Batch update matched slots → `state = FREE`, null `reservedAt`, `reservedUntil`, `inCartUntil`, `currentConfigId`.
5. Batch update linked `CustomizationConfig` records → `state = EXPIRED`.
6. Return `{ freedSlots: N, expiredConfigs: N, timestamp: ISO }`.

#### Route: `POST /api/admin/cron/cleanup-drafts`
File: `app/routes/api.admin.cron.cleanup-drafts.tsx`

Steps:
1. Delete `CustomizationDraft` where `createdAt < now() - 24h`.
2. Return `{ deleted: N, timestamp: ISO }`.

#### VPS cron (Phase 2)
Document in `docs/ops/cron-setup.md`. Entries to be added manually:
```
*/5 * * * *  curl -sf -X POST https://insignia.optidigi.nl/api/admin/cron/cleanup-slots \
               -H "Authorization: Bearer $CRON_SECRET" | logger -t insignia-cron
0   * * * *  curl -sf -X POST https://insignia.optidigi.nl/api/admin/cron/cleanup-drafts \
               -H "Authorization: Bearer $CRON_SECRET" | logger -t insignia-cron
```

---

## 2. Rate Limiting (§2.2)

### Problem
Storefront proxy endpoints have no throttling. A bad actor can exhaust the variant pool
or hammer uploads with no consequence.

### Solution

Package: `express-rate-limit` (pure Express middleware, zero Remix-layer changes).

**Location:** `server.mjs`, added before the React Router catch-all.

| Route | Limit | Window |
|---|---|---|
| `/apps/insignia/prepare` | 100 req | 15 min / IP |
| `/apps/insignia/config` | 100 req | 15 min / IP |
| `/apps/insignia/upload` | 20 req | 15 min / IP |

On breach: HTTP 429, JSON body `{ error: { message: "Too many requests", code: "RATE_LIMITED" } }`.
Standard `RateLimit-*` response headers enabled; legacy `X-RateLimit-*` disabled.

---

## 3. CI Quality Gate (§8.1)

### Problem
Docker image builds and deploys to production without running typecheck or lint.
A broken-types commit ships immediately.

### Solution

Split `.github/workflows/docker-publish.yml` into two jobs:

**`quality` job** — runs on **all branch pushes and tags**:
- `actions/setup-node@v4` with Node 20, `npm ci`, `npm run typecheck`, `npm run lint`

**`build-and-push` job** — unchanged except:
- `needs: quality`
- `if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')`

Effect: pushing `feat/phase1-hardening` runs quality checks but never triggers Docker publish.

---

## 4. Order Production Status (§2.5 + §4.2)

### Problem
`artworkStatus` and `productionStatus` are stored but never updated after order creation.
Merchants have no way to track production progress.

### Solution

#### Backend route
File: `app/routes/api.admin.orders.$id.status.tsx`

- `PATCH` only, `authenticate.admin` required.
- URL param `:id` is the encoded Shopify Order GID (same format as `app.orders.$id.tsx`).
- Body (JSON): `{ artworkStatus?: ArtworkStatus, productionStatus?: ProductionStatus, lineId?: string }`
- Validates that at least one field is present; validates enums against Prisma-generated types.
- No `lineId` → updates all `OrderLineCustomization` records for that `shopifyOrderId`.
- With `lineId` → updates only the matching record (reserved for future per-line granularity).
- Returns `{ updated: N }`.

#### UI addition in `app.orders.$id.tsx`
A new Polaris `Card` titled "Production Management" placed after the order header section:

- Two `Select` components:
  - Artwork Status: `PROVIDED | PENDING_CUSTOMER`
  - Production Status: `ARTWORK_PENDING | ARTWORK_PROVIDED | IN_PRODUCTION | QUALITY_CHECK | SHIPPED`
- Seeded with the current status of the first line (aggregate display; shows "Mixed" if lines differ).
- Fetcher-based PATCH submit — no full page reload.
- Optimistic update: selects update immediately; roll back on error.
- `Banner tone="success"` on save confirmation; `Banner tone="critical"` on error.

---

## 5. Test Suite (§1.2)

### Problem
Zero test coverage. Variant pool, price calculation, and order binding are unguarded.

### Solution

**Tooling additions to `package.json`:**
- `vitest` (test runner)
- `@vitest/coverage-v8` (coverage)
- `vitest-mock-extended` (type-safe Prisma mock)

**Config:** `vitest.config.ts` at project root — `environment: 'node'`, path aliases matching `tsconfig.json`.

**Test script:** `"test": "vitest run"`, `"test:coverage": "vitest run --coverage"`.

**Initial test files:**

`app/lib/services/__tests__/variant-pool.server.test.ts`
- Slot reservation happy path (FREE → RESERVED)
- Expired slot reclaim before new reservation
- Pool exhaustion triggers self-heal (provisions new slots)
- Double-reservation guard (concurrent calls get different slots)

`app/lib/services/__tests__/storefront-prepare.server.test.ts`
- Price calculation for a single placement
- Idempotent re-prepare (same draft + valid slot → returns existing config)
- Expired config → new slot allocated

`app/lib/services/__tests__/cron-cleanup.server.test.ts`
- RESERVED slots past `reservedUntil` are freed and linked configs expired
- IN_CART slots past `inCartUntil` are freed
- Drafts older than 24h are deleted; newer drafts are left

---

## 6. Docs + Minor (§3.2, §8.4)

- `docs/core/api-contracts/storefront.md` — replace presigned-PUT upload section with accurate server-side upload description.
- `package.json` — add `"repository"` and `"homepage"` fields.
- `docs/ops/cron-setup.md` — new file documenting VPS cron entries (Phase 2 execution).
- `AUDIT.md` — move §4.1 and §5.4 to §9 Completed; update §10 priority table.

---

## Files Touched

| File | Change |
|---|---|
| `app/lib/cron-auth.server.ts` | New — bearer token auth helper |
| `app/routes/api.admin.cron.cleanup-slots.tsx` | New — slot expiry cron endpoint |
| `app/routes/api.admin.cron.cleanup-drafts.tsx` | New — draft cleanup cron endpoint |
| `server.mjs` | Add rate limiting middleware |
| `package.json` | Add express-rate-limit, vitest deps; add repo metadata |
| `.github/workflows/docker-publish.yml` | Add quality job, gate build on it |
| `app/routes/api.admin.orders.$id.status.tsx` | New — order status PATCH endpoint |
| `app/routes/app.orders.$id.tsx` | Add Production Management card + fetcher |
| `vitest.config.ts` | New — test runner config |
| `app/lib/services/__tests__/variant-pool.server.test.ts` | New — unit tests |
| `app/lib/services/__tests__/storefront-prepare.server.test.ts` | New — unit tests |
| `app/lib/services/__tests__/cron-cleanup.server.test.ts` | New — unit tests |
| `docs/core/api-contracts/storefront.md` | Update upload section |
| `docs/ops/cron-setup.md` | New — VPS cron documentation |
| `AUDIT.md` | Mark §4.1, §5.4 done; update priority table |

---

## Out of Scope (Phase 2 / Phase 3)

- VPS cron entry creation (Phase 2 — manual SSH)
- Sentry DSN confirmation on VPS (Phase 2)
- `CRON_SECRET` env var on VPS (Phase 2)
- `RESEND_API_KEY` + merchant email notification (future session)
- Storefront mobile layout audit (Phase 3)
- Empty states + onboarding (Phase 3)
- View Editor UX / Logo sizing UX (Phase 3 — design decision needed)
