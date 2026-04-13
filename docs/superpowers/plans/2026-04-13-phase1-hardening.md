# Phase 1 Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Insignia app with proactive slot/draft cleanup crons, storefront rate limiting, CI quality gate, and a unit test suite covering variant pool and prepare logic.

**Architecture:** New cleanup logic lives in a dedicated service (`cron-cleanup.server.ts`) that accepts a Prisma client — keeping it pure and directly testable without module mocking. Rate limiting is Express middleware added to `server.mjs` before the React Router handler. The CI workflow splits into a `quality` job (all branches) and a gated `build-and-push` job (main/tags only).

**Tech Stack:** React Router 7 / Express, Prisma + PostgreSQL, `express-rate-limit`, Vitest + `vitest-mock-extended`

**Branch:** `feat/phase1-hardening` (worktree — do not push to `main` until user approval)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `app/lib/cron-auth.server.ts` | Create | Bearer-token auth helper for cron routes |
| `app/lib/services/cron-cleanup.server.ts` | Create | Pure cleanup functions (slots + drafts) |
| `app/lib/services/__tests__/cron-cleanup.server.test.ts` | Create | Unit tests for cleanup service |
| `app/lib/services/__tests__/variant-pool.server.test.ts` | Create | Unit tests for variant pool provisioning logic |
| `app/lib/services/__tests__/storefront-prepare.server.test.ts` | Create | Unit tests for prepare service |
| `app/routes/api.admin.cron.cleanup-slots.tsx` | Create | POST /api/admin/cron/cleanup-slots |
| `app/routes/api.admin.cron.cleanup-drafts.tsx` | Create | POST /api/admin/cron/cleanup-drafts |
| `server.mjs` | Modify | Add rate limiting middleware |
| `.github/workflows/docker-publish.yml` | Modify | Add quality gate job |
| `vitest.config.ts` | Create | Vitest configuration |
| `package.json` | Modify | Add test scripts, new deps, repo metadata |
| `docs/ops/cron-setup.md` | Create | VPS cron entries reference (Phase 2 execution) |
| `docs/core/api-contracts/storefront.md` | Modify | Fix upload section to match implementation |
| `AUDIT.md` | Modify | Mark §4.1, §5.4, §2.5, §4.2 complete; update priority table |

---

## Task 1: Create git worktree + feature branch

**Files:** none (git operations only)

- [ ] **Step 1: Create the worktree**

```bash
cd C:\Users\Shimmy\Desktop\env\sandbox\insignia
git worktree add ../insignia-phase1 -b feat/phase1-hardening
```

Expected output:
```
Preparing worktree (new branch 'feat/phase1-hardening')
HEAD is now at 335220d chore: cleanup, consistent naming, updated docs and audit
```

- [ ] **Step 2: Verify worktree**

```bash
git worktree list
```

Expected: two entries — the main workspace and `../insignia-phase1`.

- [ ] **Step 3: All subsequent work happens in `../insignia-phase1`**

All file edits and commands from Task 2 onward use `C:\Users\Shimmy\Desktop\env\sandbox\insignia-phase1` as the working directory.

---

## Task 2: Update AUDIT.md

**Files:** `AUDIT.md`

- [ ] **Step 1: Mark completed items in §9**

Add these four entries to the "Completed" section (§9):

```markdown
- ✅ Artwork download button on order detail — presigned GET URL via `getPresignedDownloadUrl()`, rendered at `app/routes/app.orders.$id.tsx:785`
- ✅ CSV export UI button — Export CSV button at `app/routes/app.orders._index.tsx:255` calling `/api/admin/orders/export`
- ✅ Order production status API — `advance-status` intent handler in `app/routes/app.orders.$id.tsx:380`
- ✅ Order production status UI controls — per-line action buttons in `app/routes/app.orders.$id.tsx:833`
```

- [ ] **Step 2: Update §10 priority table**

Remove rows for §4.1, §5.4, §2.5, §4.2. Renumber remaining rows. Updated table:

```markdown
| # | Item | Section | Effort | Impact |
|---|---|---|---|---|
| 1 | Apply for Shopify protected data access | §1.1 | Low (form) | 🔴 Critical |
| 2 | Confirm `SENTRY_DSN` on VPS | §2.1 | 5 min | 🔴 Critical |
| 3 | Variant slot expiry cron | §1.3 | 2–3 h | 🔴 Critical |
| 4 | `CustomizationDraft` cleanup cron | §2.3 | 1–2 h | 🟡 High |
| 5 | Rate limiting on storefront endpoints | §2.2 | 2–3 h | 🟡 High |
| 6 | Add lint/typecheck gate to CI | §8.1 | 30 min | 🟡 High |
| 7 | Merchant email notification on new order | §2.4 | 4–6 h | 🟡 High |
| 8 | Empty states + onboarding checklist | §4.3, §5.7 | 1 day | 🟡 High |
| 9 | Test suite — variant pool + storefront prep | §1.2 | 2–3 days | 🟡 High |
| 10 | Storefront mobile layout audit | §4.4 | 4–6 h | 🟡 High |
| 11 | View Editor UX decision + implementation | §4.5 | 1–2 days | 🟡 High |
| 12 | Logo sizing UX decision | §4.6 | 1 day | 🟡 High |
| 13 | Orders filter by artwork status | §5.3 | 2–3 h | 🟢 Medium |
| 14 | Storefront artwork re-upload shortcut | §5.1 | 3–4 h | 🟢 Medium |
| 15 | Placement editor zoom/pan | §5.2 | 2–3 h | 🟢 Medium |
| 16 | Staging environment | §8.2 | 1 day | 🟢 Medium |
| 17 | Multi-image support per view | §3.1 | 2–3 days | 🟢 Medium |
```

- [ ] **Step 3: Commit**

```bash
git add AUDIT.md
git commit -m "docs(audit): mark §4.1, §5.4, §2.5, §4.2 complete — already implemented"
```

---

## Task 3: CI quality gate (§8.1)

**Files:** `.github/workflows/docker-publish.yml`

- [ ] **Step 1: Replace the file contents**

```yaml
# .github/workflows/docker-publish.yml
#
# Builds the Insignia Docker image and pushes it to GitHub Container Registry.
# Triggers:
#   - Any branch push → runs quality check (typecheck + lint)
#   - Push to main or version tag v*.*.* → also builds and pushes Docker image

name: Publish Docker Image

on:
  push:
    branches:
      - '**'
    tags:
      - "v*.*.*"

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: optidigi/insignia-app

jobs:
  quality:
    name: Typecheck & Lint
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4.3.1

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

  build-and-push:
    name: Build & Push Docker Image
    needs: quality
    if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4.3.1

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3.12.0

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3.7.0
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5.10.0
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-,enable={{is_default_branch}}
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}

      - name: Build and push Docker image
        uses: docker/build-push-action@v6.19.2
        with:
          context: .
          platforms: linux/amd64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/docker-publish.yml
git commit -m "ci: add typecheck + lint quality gate before Docker build"
```

---

## Task 4: Install new dependencies

**Files:** `package.json`

- [ ] **Step 1: Install runtime dependency**

```bash
npm install express-rate-limit
```

- [ ] **Step 2: Install dev dependencies**

```bash
npm install --save-dev vitest @vitest/coverage-v8 vitest-mock-extended
```

- [ ] **Step 3: Add test scripts and repo metadata to package.json**

In the `"scripts"` block, add after `"typecheck"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

In the root of the JSON object, add after `"private"`:
```json
"repository": {
  "type": "git",
  "url": "https://github.com/optidigi/insignia-app.git"
},
"homepage": "https://insignia.optidigi.nl",
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add express-rate-limit, vitest; add test scripts and package metadata"
```

---

## Task 5: Vitest configuration

**Files:** `vitest.config.ts`

- [ ] **Step 1: Create vitest.config.ts**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: ["app/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["app/lib/services/**/*.server.ts"],
    },
  },
});
```

- [ ] **Step 2: Run tests to confirm zero tests pass (infrastructure is wired)**

```bash
npm test
```

Expected: `No test files found` or `0 tests passed` — confirms Vitest is wired.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test: add vitest configuration"
```

---

## Task 6: Rate limiting (§2.2)

**Files:** `server.mjs`

- [ ] **Step 1: Add rate limiters to server.mjs**

Replace the current `server.mjs` with:

```javascript
/**
 * Custom production server for Insignia.
 *
 * Replaces `react-router-serve` to add CORS headers on all responses.
 * This is required because the storefront modal is served via the Shopify
 * app proxy at myshopify.com, while assets are fetched directly from
 * insignia.optidigi.nl — a different origin. React Router uses
 * <script type="module"> which requires CORS for cross-origin loading.
 */

import { createRequestHandler } from "@react-router/express";
import express from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BUILD_SERVER = path.resolve(__dirname, "build/server/index.js");
const CLIENT_DIR = path.resolve(__dirname, "build/client");

const app = express();
app.disable("x-powered-by");

// CORS headers — required for <script type="module"> loaded cross-origin
// when the Shopify app proxy serves HTML at myshopify.com but assets
// are fetched directly from insignia.optidigi.nl.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  next();
});

// Rate limiting for storefront proxy endpoints.
// These endpoints are public (no auth) and handle slot reservation + uploads.
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { message: "Too many requests. Please try again later.", code: "RATE_LIMITED" } });
  },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { message: "Too many upload requests. Please try again later.", code: "RATE_LIMITED" } });
  },
});

app.use("/apps/insignia/prepare", standardLimiter);
app.use("/apps/insignia/config", standardLimiter);
app.use("/apps/insignia/upload", uploadLimiter);

// Static assets with long-lived cache.
app.use(
  "/assets",
  express.static(path.join(CLIENT_DIR, "assets"), {
    immutable: true,
    maxAge: "1y",
  })
);

// Everything else in build/client (favicon, manifest, etc.).
app.use(express.static(CLIENT_DIR, { maxAge: "1h" }));

// React Router SSR.
app.all(
  "*",
  createRequestHandler({
    build: () => import(BUILD_SERVER),
    mode: process.env.NODE_ENV,
  })
);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  // Match react-router-serve log format so health checks / logs are unaffected.
  console.log(`[react-router-serve] http://localhost:${port} (http://0.0.0.0:${port})`);
});
```

- [ ] **Step 2: Commit**

```bash
git add server.mjs
git commit -m "feat(security): add rate limiting to storefront proxy endpoints"
```

---

## Task 7: Cron cleanup service + tests (§1.3, §2.3)

**Files:**
- Create: `app/lib/services/cron-cleanup.server.ts`
- Create: `app/lib/services/__tests__/cron-cleanup.server.test.ts`

### Step A — Write the failing tests first

- [ ] **Step 1: Create the test file**

```typescript
// app/lib/services/__tests__/cron-cleanup.server.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { cleanupExpiredSlots, cleanupStaleDrafts } from "../cron-cleanup.server";

const db = mockDeep<PrismaClient>();

beforeEach(() => {
  mockReset(db);
});

describe("cleanupExpiredSlots", () => {
  it("frees expired RESERVED slots and expires their linked configs", async () => {
    db.variantSlot.findMany
      .mockResolvedValueOnce([{ id: "slot-1", currentConfigId: "cfg-1" }] as never)
      .mockResolvedValueOnce([] as never); // no expired IN_CART
    db.variantSlot.updateMany.mockResolvedValue({ count: 1 });
    db.customizationConfig.updateMany.mockResolvedValue({ count: 1 });

    const result = await cleanupExpiredSlots(db as unknown as PrismaClient);

    expect(result).toEqual({ freedSlots: 1, expiredConfigs: 1 });
    expect(db.variantSlot.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["slot-1"] } },
      data: {
        state: "FREE",
        reservedAt: null,
        reservedUntil: null,
        inCartUntil: null,
        currentConfigId: null,
      },
    });
    expect(db.customizationConfig.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["cfg-1"] } },
      data: { state: "EXPIRED" },
    });
  });

  it("frees expired IN_CART slots", async () => {
    db.variantSlot.findMany
      .mockResolvedValueOnce([] as never) // no expired RESERVED
      .mockResolvedValueOnce([{ id: "slot-2", currentConfigId: null }] as never);
    db.variantSlot.updateMany.mockResolvedValue({ count: 1 });

    const result = await cleanupExpiredSlots(db as unknown as PrismaClient);

    expect(result).toEqual({ freedSlots: 1, expiredConfigs: 0 });
    expect(db.customizationConfig.updateMany).not.toHaveBeenCalled();
  });

  it("returns zeros and makes no DB writes when nothing has expired", async () => {
    db.variantSlot.findMany.mockResolvedValue([] as never);

    const result = await cleanupExpiredSlots(db as unknown as PrismaClient);

    expect(result).toEqual({ freedSlots: 0, expiredConfigs: 0 });
    expect(db.variantSlot.updateMany).not.toHaveBeenCalled();
    expect(db.customizationConfig.updateMany).not.toHaveBeenCalled();
  });

  it("handles slots with no linked config (currentConfigId is null)", async () => {
    db.variantSlot.findMany
      .mockResolvedValueOnce([
        { id: "slot-3", currentConfigId: null },
        { id: "slot-4", currentConfigId: "cfg-4" },
      ] as never)
      .mockResolvedValueOnce([] as never);
    db.variantSlot.updateMany.mockResolvedValue({ count: 2 });
    db.customizationConfig.updateMany.mockResolvedValue({ count: 1 });

    const result = await cleanupExpiredSlots(db as unknown as PrismaClient);

    expect(result).toEqual({ freedSlots: 2, expiredConfigs: 1 });
    // Only cfg-4 should be expired — null config IDs are filtered out
    expect(db.customizationConfig.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["cfg-4"] } },
      data: { state: "EXPIRED" },
    });
  });
});

describe("cleanupStaleDrafts", () => {
  it("deletes drafts older than 24 hours", async () => {
    db.customizationDraft.deleteMany.mockResolvedValue({ count: 42 });

    const result = await cleanupStaleDrafts(db as unknown as PrismaClient);

    expect(result).toEqual({ deleted: 42 });

    const call = db.customizationDraft.deleteMany.mock.calls[0][0];
    // The cutoff passed to deleteMany should be roughly 24h ago
    const cutoff = call?.where?.createdAt?.lt as Date;
    const diff = Date.now() - cutoff.getTime();
    expect(diff).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it("returns zero when no stale drafts exist", async () => {
    db.customizationDraft.deleteMany.mockResolvedValue({ count: 0 });

    const result = await cleanupStaleDrafts(db as unknown as PrismaClient);

    expect(result).toEqual({ deleted: 0 });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (service doesn't exist yet)**

```bash
npm test
```

Expected: `Cannot find module '../cron-cleanup.server'` error.

### Step B — Implement the service

- [ ] **Step 3: Create the service**

```typescript
// app/lib/services/cron-cleanup.server.ts
/**
 * Cron cleanup operations.
 * Pure functions that accept a PrismaClient — testable without module mocking.
 * Canonical: docs/ops/cron-setup.md
 */

import type { PrismaClient } from "@prisma/client";

/**
 * Free all expired RESERVED and IN_CART variant slots and expire their linked configs.
 * Returns counts for observability logging.
 */
export async function cleanupExpiredSlots(
  prisma: PrismaClient
): Promise<{ freedSlots: number; expiredConfigs: number }> {
  const now = new Date();

  const [expiredReserved, expiredInCart] = await Promise.all([
    prisma.variantSlot.findMany({
      where: { state: "RESERVED", reservedUntil: { lt: now } },
      select: { id: true, currentConfigId: true },
    }),
    prisma.variantSlot.findMany({
      where: { state: "IN_CART", inCartUntil: { lt: now } },
      select: { id: true, currentConfigId: true },
    }),
  ]);

  const allExpired = [...expiredReserved, ...expiredInCart];
  if (allExpired.length === 0) {
    return { freedSlots: 0, expiredConfigs: 0 };
  }

  const slotIds = allExpired.map((s) => s.id);
  const configIds = allExpired
    .map((s) => s.currentConfigId)
    .filter((id): id is string => id !== null);

  await prisma.variantSlot.updateMany({
    where: { id: { in: slotIds } },
    data: {
      state: "FREE",
      reservedAt: null,
      reservedUntil: null,
      inCartUntil: null,
      currentConfigId: null,
    },
  });

  let expiredConfigs = 0;
  if (configIds.length > 0) {
    const result = await prisma.customizationConfig.updateMany({
      where: { id: { in: configIds } },
      data: { state: "EXPIRED" },
    });
    expiredConfigs = result.count;
  }

  return { freedSlots: allExpired.length, expiredConfigs };
}

/**
 * Delete CustomizationDraft records older than 24 hours.
 * Abandoned storefront sessions never clean themselves up.
 */
export async function cleanupStaleDrafts(
  prisma: PrismaClient
): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.customizationDraft.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: result.count };
}
```

- [ ] **Step 4: Run tests — they must all pass**

```bash
npm test
```

Expected:
```
✓ cleanupExpiredSlots > frees expired RESERVED slots and expires their linked configs
✓ cleanupExpiredSlots > frees expired IN_CART slots
✓ cleanupExpiredSlots > returns zeros and makes no DB writes when nothing has expired
✓ cleanupExpiredSlots > handles slots with no linked config
✓ cleanupStaleDrafts > deletes drafts older than 24 hours
✓ cleanupStaleDrafts > returns zero when no stale drafts exist
6 tests passed
```

- [ ] **Step 5: Commit**

```bash
git add app/lib/services/cron-cleanup.server.ts \
        app/lib/services/__tests__/cron-cleanup.server.test.ts
git commit -m "feat(cron): add cron cleanup service with unit tests"
```

---

## Task 8: Cron auth helper

**Files:**
- Create: `app/lib/cron-auth.server.ts`

- [ ] **Step 1: Create the auth helper**

```typescript
// app/lib/cron-auth.server.ts
/**
 * Validates the Authorization header for cron endpoints.
 *
 * In production: requires CRON_SECRET env var and a matching Bearer token.
 *                Throws a 401 Response if missing or wrong — caller must not catch it.
 * In development: if CRON_SECRET is not set, allows through (fail-open for convenience).
 */
export function verifyCronToken(request: Request): void {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[cron-auth] CRON_SECRET not configured in production — blocking request");
      throw new Response("Unauthorized: CRON_SECRET not configured on server", { status: 401 });
    }
    // Development with no secret: allow through
    console.warn("[cron-auth] CRON_SECRET not set — skipping auth (development only)");
    return;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    throw new Response("Unauthorized", { status: 401 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/lib/cron-auth.server.ts
git commit -m "feat(cron): add bearer token auth helper for cron routes"
```

---

## Task 9: Cron route — cleanup-slots (§1.3)

**Files:**
- Create: `app/routes/api.admin.cron.cleanup-slots.tsx`

- [ ] **Step 1: Create the route**

```typescript
// app/routes/api.admin.cron.cleanup-slots.tsx
/**
 * Cron: Free expired variant slots and expire linked customization configs.
 *
 * POST /api/admin/cron/cleanup-slots
 * Authorization: Bearer $CRON_SECRET
 *
 * Called every 5 minutes by VPS cron (see docs/ops/cron-setup.md).
 * Safe to call more frequently — no-ops if nothing has expired.
 */

import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { verifyCronToken } from "../lib/cron-auth.server";
import { cleanupExpiredSlots } from "../lib/services/cron-cleanup.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  verifyCronToken(request);

  const result = await cleanupExpiredSlots(db);
  console.log(`[cron/cleanup-slots] freed=${result.freedSlots} expired_configs=${result.expiredConfigs}`);

  return Response.json({ ...result, timestamp: new Date().toISOString() });
};
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/routes/api.admin.cron.cleanup-slots.tsx
git commit -m "feat(cron): add POST /api/admin/cron/cleanup-slots endpoint"
```

---

## Task 10: Cron route — cleanup-drafts (§2.3)

**Files:**
- Create: `app/routes/api.admin.cron.cleanup-drafts.tsx`

- [ ] **Step 1: Create the route**

```typescript
// app/routes/api.admin.cron.cleanup-drafts.tsx
/**
 * Cron: Delete abandoned CustomizationDraft records older than 24 hours.
 *
 * POST /api/admin/cron/cleanup-drafts
 * Authorization: Bearer $CRON_SECRET
 *
 * Called hourly by VPS cron (see docs/ops/cron-setup.md).
 */

import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { verifyCronToken } from "../lib/cron-auth.server";
import { cleanupStaleDrafts } from "../lib/services/cron-cleanup.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  verifyCronToken(request);

  const result = await cleanupStaleDrafts(db);
  console.log(`[cron/cleanup-drafts] deleted=${result.deleted}`);

  return Response.json({ ...result, timestamp: new Date().toISOString() });
};
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/routes/api.admin.cron.cleanup-drafts.tsx
git commit -m "feat(cron): add POST /api/admin/cron/cleanup-drafts endpoint"
```

---

## Task 11: VPS cron documentation

**Files:**
- Create: `docs/ops/cron-setup.md`

- [ ] **Step 1: Create cron documentation**

```markdown
# VPS Cron Setup

These cron jobs must be added on the production VPS after Phase 2 deployment.
Run `crontab -e` as the user running the Insignia Docker container.

## Prerequisites

- `CRON_SECRET` must be set in the VPS `.env` file (same value used in Docker Compose).
- The app must be running and reachable at `https://insignia.optidigi.nl`.

## Entries

```cron
# Insignia cron jobs
# Clean up expired variant slots every 5 minutes
*/5 * * * *  curl -sf -X POST https://insignia.optidigi.nl/api/admin/cron/cleanup-slots -H "Authorization: Bearer $CRON_SECRET" | logger -t insignia-cron

# Clean up stale customization drafts hourly
0 * * * *    curl -sf -X POST https://insignia.optidigi.nl/api/admin/cron/cleanup-drafts -H "Authorization: Bearer $CRON_SECRET" | logger -t insignia-cron
```

## Verifying

```bash
# Test slot cleanup manually
curl -v -X POST https://insignia.optidigi.nl/api/admin/cron/cleanup-slots \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Expected response:
# {"freedSlots":0,"expiredConfigs":0,"timestamp":"2026-04-13T..."}

# View cron logs
journalctl -t insignia-cron -n 50
```

## Environment variable

Add to `/opt/insignia/.env` on the VPS:

```
CRON_SECRET=<generate with: openssl rand -hex 32>
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/ops/cron-setup.md
git commit -m "docs(ops): add VPS cron setup instructions for slot and draft cleanup"
```

---

## Task 12: Variant pool unit tests (§1.2)

**Files:**
- Create: `app/lib/services/__tests__/variant-pool.server.test.ts`

These tests mock the `db` module to verify the provisioning and ensure-exists logic.

- [ ] **Step 1: Create the test file**

```typescript
// app/lib/services/__tests__/variant-pool.server.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

// Must be called before the import that uses db
const prismaMock = mockDeep<PrismaClient>();
vi.mock("../../db.server", () => ({ default: prismaMock }));

// Import AFTER the mock is set up
const { provisionVariantPool, ensureVariantPoolExists } = await import(
  "../variant-pool.server"
);

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

/** Minimal adminGraphql mock that returns empty success responses */
function makeAdminGraphql(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue({
      data: {
        publications: { edges: [{ node: { id: "pub-1", name: "Online Store" } }] },
        publishablePublish: { userErrors: [] },
        productCreate: {
          product: {
            id: "gid://shopify/Product/99",
            variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/1" } }] },
          },
          userErrors: [],
        },
        productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
        productVariantsBulkCreate: {
          productVariants: Array.from({ length: 9 }, (_, i) => ({
            id: `gid://shopify/ProductVariant/${i + 2}`,
          })),
          userErrors: [],
        },
        inventoryItemUpdate: { inventoryItem: { tracked: false }, userErrors: [] },
        product: { id: overrides.productId ?? "gid://shopify/Product/99" },
        ...overrides,
      },
    }),
  });
}

describe("provisionVariantPool", () => {
  it("is idempotent — skips provisioning if slots already exist", async () => {
    prismaMock.variantSlot.count.mockResolvedValue(10);
    prismaMock.variantSlot.findFirst.mockResolvedValue({
      shopifyProductId: "gid://shopify/Product/existing",
    } as never);

    const adminGraphql = makeAdminGraphql();
    const result = await provisionVariantPool("shop-1", "method-1", "Embroidery", adminGraphql);

    expect(result.slotCount).toBe(10);
    expect(result.productId).toBe("gid://shopify/Product/existing");
    // Must not have called Shopify to create a new product
    expect(adminGraphql).not.toHaveBeenCalledWith(
      expect.stringContaining("productCreate"),
      expect.anything()
    );
  });

  it("creates a fee product and 10 slot rows when no slots exist", async () => {
    prismaMock.variantSlot.count.mockResolvedValue(0);
    prismaMock.variantSlot.create.mockResolvedValue({} as never);
    prismaMock.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops.map(() => ({}));
      return (ops as (tx: unknown) => Promise<unknown>)(prismaMock);
    });

    const adminGraphql = makeAdminGraphql();
    const result = await provisionVariantPool("shop-1", "method-1", "Embroidery", adminGraphql);

    expect(result.productId).toBe("gid://shopify/Product/99");
    expect(result.slotCount).toBe(10);

    // Should have called productCreate mutation
    expect(adminGraphql).toHaveBeenCalledWith(
      expect.stringContaining("productCreate"),
      expect.objectContaining({
        product: expect.objectContaining({ status: "UNLISTED" }),
      })
    );
  });
});

describe("ensureVariantPoolExists", () => {
  it("calls provisionVariantPool when no slots exist for the method", async () => {
    prismaMock.variantSlot.findFirst
      .mockResolvedValueOnce(null) // ensureVariantPoolExists check
      .mockResolvedValueOnce(null); // provisionVariantPool idempotency check (count = 0 is tested separately)
    prismaMock.variantSlot.count.mockResolvedValue(0);
    prismaMock.decorationMethod.findFirst.mockResolvedValue({
      id: "method-1",
      shopId: "shop-1",
      name: "Embroidery",
    } as never);
    prismaMock.variantSlot.create.mockResolvedValue({} as never);
    prismaMock.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops.map(() => ({}));
      return (ops as (tx: unknown) => Promise<unknown>)(prismaMock);
    });

    const adminGraphql = makeAdminGraphql();
    await ensureVariantPoolExists("shop-1", "method-1", adminGraphql);

    expect(prismaMock.decorationMethod.findFirst).toHaveBeenCalledWith({
      where: { id: "method-1", shopId: "shop-1" },
    });
    expect(adminGraphql).toHaveBeenCalledWith(
      expect.stringContaining("productCreate"),
      expect.anything()
    );
  });

  it("throws NOT_FOUND when method does not exist", async () => {
    prismaMock.variantSlot.findFirst.mockResolvedValue(null);
    prismaMock.variantSlot.count.mockResolvedValue(0);
    prismaMock.decorationMethod.findFirst.mockResolvedValue(null);

    const adminGraphql = makeAdminGraphql();
    await expect(
      ensureVariantPoolExists("shop-1", "missing-method", adminGraphql)
    ).rejects.toThrow("Method not found");
  });

  it("re-provisions when fee product no longer exists in Shopify", async () => {
    prismaMock.variantSlot.findFirst.mockResolvedValue({
      shopifyProductId: "gid://shopify/Product/deleted",
    } as never);
    // feeProductExistsInShopify returns false (product.id is null)
    const adminGraphql = makeAdminGraphql({ product: null });
    prismaMock.variantSlot.findMany.mockResolvedValue([
      { id: "slot-1", currentConfigId: "cfg-1" },
    ] as never);
    prismaMock.customizationConfig.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.variantSlot.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.variantSlot.count.mockResolvedValue(0);
    prismaMock.decorationMethod.findFirst.mockResolvedValue({
      id: "method-1",
      shopId: "shop-1",
      name: "Embroidery",
    } as never);
    prismaMock.variantSlot.create.mockResolvedValue({} as never);
    prismaMock.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) return ops.map(() => ({}));
      return (ops as (tx: unknown) => Promise<unknown>)(prismaMock);
    });

    // Make adminGraphql return null product on first call (existence check),
    // then return a valid product for subsequent Shopify calls
    const jsonMock = vi.fn()
      .mockResolvedValueOnce({ data: { product: null } })
      .mockResolvedValue({
        data: {
          publications: { edges: [{ node: { id: "pub-1", name: "Online Store" } }] },
          publishablePublish: { userErrors: [] },
          productCreate: {
            product: {
              id: "gid://shopify/Product/new",
              variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/1" } }] },
            },
            userErrors: [],
          },
          productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
          productVariantsBulkCreate: {
            productVariants: Array.from({ length: 9 }, (_, i) => ({
              id: `gid://shopify/ProductVariant/${i + 2}`,
            })),
            userErrors: [],
          },
          inventoryItemUpdate: { inventoryItem: { tracked: false }, userErrors: [] },
          product: { id: "gid://shopify/Product/new" },
        },
      });

    const sequentialAdminGraphql = vi.fn().mockReturnValue({ json: jsonMock });

    await ensureVariantPoolExists("shop-1", "method-1", sequentialAdminGraphql);

    // Stale slots must have been deleted
    expect(prismaMock.variantSlot.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop-1", methodId: "method-1" },
    });
    // New product must have been created
    expect(sequentialAdminGraphql).toHaveBeenCalledWith(
      expect.stringContaining("productCreate"),
      expect.anything()
    );
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test
```

Expected: all variant-pool tests pass (they document existing correct behavior). If any fail, investigate whether the existing code has a bug vs. incorrect test assumptions.

- [ ] **Step 3: Commit**

```bash
git add app/lib/services/__tests__/variant-pool.server.test.ts
git commit -m "test: add variant pool unit tests"
```

---

## Task 13: Storefront prepare unit tests (§1.2)

**Files:**
- Create: `app/lib/services/__tests__/storefront-prepare.server.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// app/lib/services/__tests__/storefront-prepare.server.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

const prismaMock = mockDeep<PrismaClient>();
vi.mock("../../db.server", () => ({ default: prismaMock }));

// Mock ensureVariantPoolExists so prepare tests don't need Shopify provisioning
vi.mock("../variant-pool.server", () => ({
  ensureVariantPoolExists: vi.fn().mockResolvedValue(undefined),
}));

// Mock computeCustomizationPrice so we control price output
vi.mock("../storefront-customizations.server", () => ({
  computeCustomizationPrice: vi.fn().mockResolvedValue({
    unitPriceCents: 1500,
    feeCents: 500,
  }),
}));

const { prepareCustomization } = await import("../storefront-prepare.server");

const MOCK_DRAFT = {
  id: "draft-1",
  shopId: "shop-1",
  methodId: "method-1",
  unitPriceCents: 1500,
  feeCents: 500,
  configHash: "abc123",
  pricingVersion: "v1",
  placements: [],
  logoAssetIdsByPlacementId: {},
  artworkStatus: "PROVIDED",
  productId: "gid://shopify/Product/1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_SLOT = {
  id: "slot-1",
  shopifyProductId: "gid://shopify/Product/99",
  shopifyVariantId: "gid://shopify/ProductVariant/1",
};

function makeAdminGraphql() {
  return vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue({
      data: {
        product: { id: "gid://shopify/Product/99" },
        productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
      },
    }),
  });
}

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
});

describe("prepareCustomization", () => {
  it("throws NOT_FOUND when the draft does not exist", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(null);
    const adminGraphql = makeAdminGraphql();

    await expect(
      prepareCustomization("shop-1", "nonexistent-draft", adminGraphql)
    ).rejects.toThrow("Customization not found");
  });

  it("returns existing config when already prepared and fee product still exists", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(MOCK_DRAFT as never);
    prismaMock.customizationConfig.findFirst.mockResolvedValue({
      id: "cfg-existing",
      configHash: "abc123",
      pricingVersion: "v1",
      unitPriceCents: 1500,
      feeCents: 500,
      state: "RESERVED",
      variantSlot: {
        shopifyVariantId: "gid://shopify/ProductVariant/1",
        shopifyProductId: "gid://shopify/Product/99",
      },
    } as never);

    const adminGraphql = makeAdminGraphql();
    const result = await prepareCustomization("shop-1", "draft-1", adminGraphql);

    expect(result.slotVariantId).toBe("gid://shopify/ProductVariant/1");
    expect(result.configHash).toBe("abc123");
    // Should not have reserved a new slot
    expect(prismaMock.variantSlot.update).not.toHaveBeenCalled();
  });

  it("reserves a free slot and returns pricing when no prior config exists", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(MOCK_DRAFT as never);
    prismaMock.customizationConfig.findFirst.mockResolvedValue(null); // no existing config
    prismaMock.variantSlot.findMany.mockResolvedValue([]); // no expired slots to reclaim
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Simulate the transaction: raw query finds a free slot, creates config, updates slot
      const fakeTx = {
        ...prismaMock,
        $queryRaw: vi.fn().mockResolvedValue([MOCK_SLOT]),
        customizationConfig: {
          ...prismaMock.customizationConfig,
          create: vi.fn().mockResolvedValue({ id: "cfg-new", ...MOCK_DRAFT }),
          update: vi.fn().mockResolvedValue({}),
        },
        variantSlot: {
          ...prismaMock.variantSlot,
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(fakeTx);
    });

    const adminGraphql = makeAdminGraphql();
    const result = await prepareCustomization("shop-1", "draft-1", adminGraphql);

    expect(result.slotVariantId).toBe("gid://shopify/ProductVariant/1");
    expect(result.unitPriceCents).toBe(1500);
    expect(result.feeCents).toBe(500);
  });

  it("throws SERVICE_UNAVAILABLE when no free slot is available", async () => {
    prismaMock.customizationDraft.findFirst.mockResolvedValue(MOCK_DRAFT as never);
    prismaMock.customizationConfig.findFirst.mockResolvedValue(null);
    prismaMock.variantSlot.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        ...prismaMock,
        $queryRaw: vi.fn().mockResolvedValue([]), // no free slots
        customizationConfig: { ...prismaMock.customizationConfig, create: vi.fn() },
        variantSlot: { ...prismaMock.variantSlot, update: vi.fn() },
      };
      return fn(fakeTx);
    });

    const adminGraphql = makeAdminGraphql();
    await expect(
      prepareCustomization("shop-1", "draft-1", adminGraphql)
    ).rejects.toThrow("All customization slots are in use");
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test
```

Expected: all prepare tests pass. If any fail, document the failure and investigate before marking this step complete.

- [ ] **Step 3: Commit**

```bash
git add app/lib/services/__tests__/storefront-prepare.server.test.ts
git commit -m "test: add storefront-prepare unit tests"
```

---

## Task 14: Fix storefront API docs (§3.2)

**Files:** `docs/core/api-contracts/storefront.md`

- [ ] **Step 1: Read the current upload section**

Open `docs/core/api-contracts/storefront.md` and find the upload section.

- [ ] **Step 2: Replace the upload section**

Find any section describing a presigned-URL upload flow (client gets a presigned PUT URL, uploads directly to R2) and replace it with the actual implementation:

```markdown
### Logo Upload

**Endpoint:** `POST /apps/insignia/upload`

The storefront modal uploads logo files directly to the app server (not to R2 via presigned PUT).

**Request:** `multipart/form-data`
- `file` — the logo file (SVG, PNG, or JPG; max 10 MB)
- `shopId` — the shop identifier

**Response:**
```json
{
  "assetId": "uuid",
  "previewUrl": "https://..."
}
```

**Server behaviour:**
1. Validates MIME type (SVG/PNG/JPG only).
2. For SVG: sanitises with DOMPurify + JSDOM before storing.
3. Generates a PNG preview via Sharp.
4. Stores both files in Cloudflare R2 under `logos/<shopId>/<assetId>.*`.
5. Creates a `LogoAsset` DB record and returns `assetId` + `previewUrl`.

> Note: The R2 bucket CORS policy allows GET and PUT. Server-side uploads go through the app server, not directly from the browser to R2.
```

- [ ] **Step 3: Commit**

```bash
git add docs/core/api-contracts/storefront.md
git commit -m "docs: correct storefront upload spec to match server-side implementation"
```

---

## Task 15: Final verification + push branch

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass with no failures.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors (pre-existing errors in unrelated generated files are acceptable; new errors are not).

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no new lint errors.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/phase1-hardening
```

This triggers the `quality` CI job (typecheck + lint) but NOT the Docker publish job (branch is not `main`). Verify on GitHub Actions that the quality job passes.

- [ ] **Step 5: Report results to user**

Summarise:
- All tasks completed / any that had issues
- Test counts (X tests passing)
- Typecheck + lint status
- Branch URL on GitHub for review
- Phase 2 items that need manual action (VPS: add `CRON_SECRET`, add cron entries, confirm `SENTRY_DSN`)

---

## Phase 2 checklist (manual — after user approval of this branch)

These cannot be automated and must be done on the VPS:

- [ ] Generate `CRON_SECRET`: `openssl rand -hex 32`
- [ ] Add `CRON_SECRET=<value>` to `/opt/insignia/.env` on VPS
- [ ] Confirm `SENTRY_DSN` is set in VPS `.env`
- [ ] Add cron entries per `docs/ops/cron-setup.md`
- [ ] Merge `feat/phase1-hardening` → `main` (triggers Docker publish + deploy)
- [ ] Verify cleanup endpoints respond correctly on production URL
