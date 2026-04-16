# Production Readiness Audit & Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full production-readiness audit and hardening pass for Insignia — zero unresolved critical/high security, documentation, or observability issues at launch.

**Architecture:** Node.js + Express custom server + React Router 7 SSR + Prisma + Shopify Admin GraphQL 2026-04 + Cloudflare R2. Storefront modal served via Shopify App Proxy. Theme extension block for customize button.

**Tech Stack:** React Router 7, React 18, Polaris 13, Prisma 6, PostgreSQL, Express, Cloudflare R2, Sentry, Vitest, Konva, sharp, DOMPurify/jsdom, zod, TypeScript strict.

---

## Audit Summary (2026-04-16)

### Validation Results (pre-fix)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm run lint` | ✅ PASS |
| `npm run test` | ✅ PASS (45 tests, 7 files) |
| `npx prisma validate` | ✅ PASS |
| `npm audit` | ⚠️ 22 vulns (1 moderate, 21 high — see below) |
| `npm outdated` | ⚠️ Several minor/patch updates available |

---

## Findings by Severity

### P1 — High (fixed in this pass)

#### F1: `write_themes` scope is unused and overly broad
- **Files:** `shopify.app.insignia.toml`, `shopify.app.insignia-demo.toml`
- **Issue:** Both toml files include `write_themes` in `access_scopes`. The only theme-related code (`app/lib/services/install-theme-block.server.ts`) only reads themes. No code calls `themeFilesUpsert` or any theme mutation. `write_themes` grants full read/write to all theme files — a significant over-permission.
- **Fix:** Remove `write_themes` from scopes in both toml files.
- **Manual op required:** `shopify app deploy --config insignia` after merge to take effect in production.

#### F2: `docs/core/auth.md` contains a false security claim
- **File:** `docs/core/auth.md` line 30
- **Issue:** States "Backend stores the access token encrypted at rest (application-layer encryption)." This is FALSE. `PrismaSessionStorage` stores tokens in plaintext. `open-work.md` and `AUDIT.md` both correctly document this as an accepted risk.
- **Risk:** Future developers/auditors reading auth.md believe encryption is implemented when it is not. This is a compliance/audit risk.
- **Fix:** Update auth.md to state tokens are currently stored in plaintext, with a reference to the open-work.md decision item.

#### F3: `apps.insignia.tsx` ErrorBoundary leaks raw error messages to storefront users
- **File:** `app/routes/apps.insignia.tsx` line 43
- **Issue:** `error.message` is rendered directly in the body. In production this could expose internal exception messages (e.g., DB query failures, internal service names) to customers viewing the storefront modal.
- **Fix:** Guard with `process.env.NODE_ENV === "production"` — show generic message in production.

#### F4: `.env.example` is incomplete — operators cannot bootstrap correctly
- **File:** `.env.example`
- **Issues:**
  1. Missing `CRON_SECRET` — without this, operators won't configure it, causing cron auth to throw 401 on first run in production
  2. Missing `RESEND_API_KEY` — merchant email notifications are silently skipped without documentation
  3. `SCOPES=write_products,read_orders,write_orders` is stale and confusing — actual scopes are defined in `shopify.app.*.toml`
- **Fix:** Add CRON_SECRET and RESEND_API_KEY with explanatory comments; annotate SCOPES as managed by toml.

### P2 — Medium (fixed in this pass)

#### F5: Sentry not initialized at Express/server.mjs level
- **File:** `server.mjs`
- **Issue:** Sentry is initialized only in `app/entry.server.tsx` (React Router SSR layer). Express-level unhandled errors — rate limiter crashes, static file server errors, uncaught promise rejections — are NOT captured by Sentry.
- **Fix:** Add `Sentry.init()` and `Sentry.setupExpressErrorHandler(app)` to server.mjs, gated on `SENTRY_DSN`.

#### F6: `docs/AGENT_ENTRY.md` has two dead links
- **File:** `docs/AGENT_ENTRY.md` lines 64, 71
- **Issue:** References `docs/notes/docs-audit.md` and `docs/notes/research/agentic-workflow-research.md` — neither file exists. Agents/developers following these links get a 404.
- **Fix:** Remove both entries.

#### F7: `CLAUDE.md` model count is wrong (13 vs 18)
- **File:** `CLAUDE.md` (project root)
- **Issue:** States "13 models" in Prisma schema; actual schema has 18 models (Session, Shop, CustomizationDraft, StorefrontUploadSession, DecorationMethod, ProductConfig, ProductConfigMethod, ProductView, VariantViewConfiguration, PlacementDefinition, PlacementStep, MerchantSettings, LogoAsset, VariantSlot, CustomizationConfig, OrderLineCustomization, WebhookEvent, StorefrontTranslation).
- **Fix:** Update to 18 models.

#### F8: `AUDIT.md` claims version 0.5.0 (actual: 0.4.0)
- **File:** `AUDIT.md` line 4
- **Issue:** Claims "Version: 0.5.0 (ui-polish + per-view-placements)". `package.json` is at 0.4.0. `package-lock.json` is stale at 0.2.0 (manual `npm version` needed).
- **Fix:** Update AUDIT.md version to reflect current state.

#### F9: `docs/core/tech-stack.md` email policy section is stale
- **File:** `docs/core/tech-stack.md`
- **Issue:** States "Automated email sending is deferred. Dashboard supports template management + manual-copy helpers. Automated send buttons are disabled with 'Coming soon' note." Reality: `merchant-notifications.server.ts` fully implements email sending via Resend (gated by RESEND_API_KEY, implemented in Phase 2).
- **Fix:** Update to reflect current state.

### P3 — Low (fixed in this pass)

#### F10: DOMPurify moderate vulnerability (GHSA-39q2-94rc-95cp)
- **Package:** `dompurify` 3.3.1 → 3.4.0
- **Vulnerability:** ADD_TAGS bypasses FORBID_TAGS. NOT currently exploitable in this codebase (code uses ADD_ATTR, not ADD_TAGS) but best to patch.
- **Fix:** Bump `dompurify` to `^3.4.0` in `package.json`.

### Left Open (cannot fix in this pass)

| Finding | Severity | Reason Left Open |
|---|---|---|
| Access token plaintext in DB | P2 | Requires significant crypto implementation. Bounded risk (VPS firewall). Documented in open-work.md. |
| Order webhooks disabled | P1 (ops) | Requires Shopify "protected customer data" approval. Manual process. |
| Sentry DSN not confirmed on VPS | P1 (ops) | Requires SSH to VPS. Cannot do from repo. |
| 21 HIGH vulns in devDependencies | P3 | All in @typescript-eslint, @graphql-codegen, lodash, minimatch — devDeps only, zero production impact. Cannot fix without major version bumps to eslint toolchain. |
| package-lock.json version (0.2.0) | P3 | Requires `npm version` which is managed by npm — stale but harmless. |
| GDPR data request delivery mechanism | P3 | Acceptable for App Store if manual process documented. Future automation. |
| No staging environment | P2 | Infrastructure decision, not code. |
| CDN for storefront modal assets | P3 | Performance nice-to-have. |
| In-memory rate limiter is per-process | P3 | Currently fine for single-instance VPS. Documented in code. |

---

## Dependency Freshness Summary

### Safe to update now (patch/minor)
| Package | Current | Latest | Action |
|---|---|---|---|
| `dompurify` | 3.3.1 | 3.4.0 | Update — patches moderate CVE |
| `@shopify/shopify-app-react-router` | 1.1.0 | 1.2.0 | Update when convenient |
| `@sentry/node` | 10.48.0 | 10.49.0 | Update when convenient |
| `@shopify/app-bridge-react` | 4.2.4 | 4.2.10 | Update when convenient |

### Defer (major version — breaking changes)
| Package | Current | Latest | Notes |
|---|---|---|---|
| `prisma` / `@prisma/client` | 6.x | 7.7.0 | Major — migration format changes; test thoroughly |
| `react` / `react-dom` | 18.x | 19.x | Major — concurrent mode changes, API removals |
| `express` | 4.x | 5.x | Major — some middleware changes |
| `jsdom` | 28.x | 29.x | Minor major — check DOMPurify compatibility |

---

## Manual Ops Tasks (cannot be done from repo)

| Task | Where | Priority |
|---|---|---|
| Confirm `SENTRY_DSN` on VPS | SSH + check `.env` | P1 |
| Apply for Shopify protected customer data | Partners Dashboard → API access | P1 (ops blocker) |
| Uncomment order webhooks + deploy | `shopify.app.insignia.toml` + `shopify app deploy` | After Shopify approval |
| Run `shopify app deploy --config insignia` | Terminal | After `write_themes` removal |
| Verify cron jobs on VPS | SSH + crontab | P2 |
| Run `npm install` to update package-lock.json | Terminal | P3 |

---

## Production-Readiness Prognosis

**Verdict: MVP-ready with documented caveats. Not App Store-ready yet.**

| Dimension | Status | Blocker? |
|---|---|---|
| Auth & tenant isolation | ✅ Solid | No |
| Storefront proxy security | ✅ Solid | No |
| Webhook security & idempotency | ✅ Solid | No |
| GDPR compliance | ✅ Sufficient for App Store | No |
| Error observability (Sentry) | ⚠️ Partial (Express layer gap) | No (fixable in this pass) |
| Order fulfillment (webhooks) | ❌ Blocked | Yes — Shopify approval required |
| Access token encryption | ⚠️ Plaintext (bounded risk) | No (documented decision) |
| Dependency security | ⚠️ Dev-only vulns | No (no production impact) |
| Rate limiting | ✅ Dual-layer | No |
| Database | ✅ Indexed, transactional, migrated | No |
| CI/CD | ✅ Lint + typecheck gate, Docker auto-deploy | No |
| Documentation | ⚠️ Several drifts (fixed in this pass) | No |
