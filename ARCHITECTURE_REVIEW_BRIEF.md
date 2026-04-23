# Insignia — Architecture Review & Hardening Brief

> **Audience:** the next Claude Code session taking over this codebase.
> Read `CLAUDE.md` first. Then read this. Then ask me one clarifying question before you audit.

---

## Your mission

You are picking up a working Shopify app (Insignia — embedded product-customization app, logo placement on garments) that has been built incrementally and is now **feature-complete enough to run**, but was not designed holistically. Your job is to:

1. **Audit** the codebase against Shopify's 2026 App guidelines and modern web-app best practices.
2. **Propose** a redesigned architecture that is more performance-driven, simpler, and more up-to-date.
3. **Harden** critical subsystems (webhooks, variant pool, app proxy, session management) so they don't regress silently.
4. **Remove** subsystems and code paths that are unnecessary, dead, or duplicative.
5. **Implement** changes interactively with me, phase by phase, without breaking essential business logic.

This is **not** a greenfield rewrite. It is a disciplined cleanup and modernization.

---

## Ground rules

### Non-negotiable — do not break these

These subsystems are load-bearing. Read the code carefully before proposing changes. Propose, then wait for my explicit approval before touching any of them:

1. **Variant Pool (fee products)** — `app/lib/services/variant-pool.server.ts`, `storefront-prepare.server.ts`. Fee products must stay `status: UNLISTED` but published to Online Store. The reservation/recycle lifecycle (`FREE → RESERVED → IN_CART → ORDERED → PURCHASED → FREE`) drives all storefront pricing. The `orders/paid` webhook is what recycles slots — if you break the webhook pipeline, the pool leaks.
2. **App Proxy authentication** — `app/routes/apps.insignia.*`. Every storefront endpoint must verify the Shopify App Proxy HMAC signature. Look at `apps.insignia.modal.tsx` for the pattern (HMAC verify ≠ session load — both happen, but only HMAC is security-critical).
3. **Webhook pipeline** — `app/routes/webhooks.*.tsx` + `app/lib/services/webhook-idempotency.server.ts`. The two orders webhooks (`orders/create`, `orders/paid`) are wired via the `[[webhooks.subscriptions]]` blocks in `shopify.app.*.toml`. If the TOML drifts from Shopify's registry, downstream breaks silently (see git log around April 2026 for the last incident).
4. **Storefront modal UX flow** — `app/components/storefront/`, `app/routes/apps.insignia.modal.tsx`. Upload → Placement → Size → Review. Do not redesign this flow without showing me mockups first.
5. **Database migrations** — `prisma/schema.prisma`. Every schema change is a migration. No destructive migrations without my explicit sign-off.
6. **Admin orders page + order-block extension** — these read `OrderLineCustomization` rows populated by `orders/create`. Coupled to the webhook pipeline.

### How you work with me

- **Audit-first, then propose, then implement.** Do not refactor anything in the first pass — just read, document, and identify problems.
- **Surface before changing.** When you find something you want to change, describe it (what, why, impact) and wait for a `yes / no / modify`.
- **Phases, not big-bang.** Break work into shippable phases. Each phase ends with typecheck + lint green, manual verification of the affected flow, and a commit.
- **Interactive.** Ask me questions. One at a time, multiple-choice when possible. Never assume about business logic I haven't explained.
- **Follow the Superpowers skills.** `brainstorming` for the design phase, `writing-plans` for implementation, `test-driven-development` for anything behavioral, `systematic-debugging` when something breaks, `code-reviewer` at every major milestone.
- **Use the Shopify Dev MCP for every Shopify interaction.** No exceptions. See `CLAUDE.md` for the tool list.
- **Verify before claiming done.** Use `superpowers:verification-before-completion`. `npm run typecheck` and `npm run lint` must exit clean.

---

## Deliverables (in order)

### Phase 0 — Kickoff (you just started)

1. Read `CLAUDE.md` and this file in full.
2. Read `docs/AGENT_ENTRY.md` to map the existing documentation.
3. Skim `prisma/schema.prisma` (19 models) — do not propose changes yet.
4. Ask me **one** clarifying question that would materially change your audit scope. Then stop.

### Phase 1 — Audit report

Produce a single markdown document at `docs/architecture-review/2026-AUDIT.md` covering:

1. **Subsystem inventory.** For each subsystem (storefront modal, admin dashboard, variant pool, webhooks, image uploads, order flow, session management, background jobs), one paragraph on what it does, where it lives, what its dependencies are, and how healthy it looks.
2. **Shopify 2026 alignment.** Compare current implementation to Shopify's latest guidelines. Areas to check — see §"Shopify 2026 checklist" below.
3. **Performance heatmap.** Identify:
   - N+1 Prisma queries
   - Missing indexes (check `prisma/schema.prisma` + query patterns)
   - Client bundle bloat (run `npm run build` and look at the chunk sizes — Konva, Polaris React, anything over ~200 KB gzipped)
   - Serial Shopify API calls that could be batched
   - Missing cache layers (product config, storefront config — currently re-fetched per request)
   - Render-blocking work on the storefront modal's critical path
4. **Dead / duplicate code.** List routes, services, components, env vars, and docs that are no longer referenced. Cross-reference with `git log` to understand why they exist.
5. **Security & compliance gaps.** Scope creep, unvalidated input, missing rate limits, webhook replay protection, protected-customer-data alignment, GDPR handlers.
6. **Top 10 findings** with severity (P0/P1/P2) and recommended action.

**Do not touch code during Phase 1.** Just read and write the report. Expect this to take multiple sessions.

### Phase 2 — Redesign proposal

For each P0/P1 finding from Phase 1, write a short design doc at `docs/architecture-review/designs/<topic>.md` (using `superpowers:brainstorming` to collaborate with me). Each design doc covers: current state, proposed state, migration path, risk, rollback plan.

I approve each design before you write any implementation code.

### Phase 3 — Phased implementation

For each approved design, use `superpowers:writing-plans` to produce a task-by-task plan at `docs/superpowers/plans/`. Then execute the plan with `superpowers:subagent-driven-development` or inline, your call — whichever matches the plan's complexity.

Each phase ships independently. `main` must stay green.

---

## Shopify 2026 checklist

This is what "up-to-date" means in 2026. Use the Shopify Dev MCP (`mcp__shopify-dev-mcp__search_docs_chunks`) to verify each of these against current docs — do not trust this list in isolation.

### App architecture

- **Managed pricing / managed billing.** If the app charges, it should be via Shopify's managed billing API, not a custom flow. Check `app/lib/services/billing.server.ts` (if it exists) or similar.
- **Session token rotation.** Embedded apps must use short-lived App Bridge session tokens, not long-lived access tokens exposed to the client. Confirm `shopify.server.ts` is using the session-token flow.
- **Protected customer data compliance.** If the app reads customer PII (email, address), it must be declared in the Partner Dashboard and access-justified. Our `orders/create` handler sees customer data — confirm declaration.
- **App Proxy alternatives.** Shopify is pushing apps toward Admin Extensions + Theme App Extensions wherever App Proxy was used. Audit `apps.insignia.*` endpoints — is the storefront modal actually best as an App Proxy page, or would a Theme App Extension block + public backend API be cleaner?
- **Webhook subscriptions via TOML.** Current — all good. Just confirm no drift (`.shopify/dev-bundle/manifest.json` vs. `shopify.app.insignia.toml`).

### UI / framework

- **Polaris Web Components (`<s-*>`)** is the current direction, not Polaris React. Admin pages being built new should use WC. Existing Polaris React pages can migrate incrementally. See `CLAUDE.md` §"UI/UX: Polaris Design System" for the conventions this repo has already adopted.
- **App Bridge 4.x** — confirm we're not on 3.x. Check `package.json` and usage patterns.
- **React Router 7** — we're already on it. Confirm we're using the framework patterns (loaders, actions, clientLoader, no custom data fetching on top).
- **No custom CSS where Polaris has a token.** Spacing, color, radius, typography — all tokens, no hardcoded px.

### Backend / data

- **GraphQL over REST.** Admin API calls should be GraphQL-first. Audit any remaining REST calls.
- **Admin API 2026-04** is pinned — good. Extensions pin their own versions.
- **Prisma indexing.** Every `where` clause on a frequently-queried field needs a compound index. Check `prisma/schema.prisma` `@@index` declarations.
- **Idempotency on webhooks.** We have `processWebhookIdempotently` — verify every webhook handler wraps its work in it.
- **Cache product config** — currently the storefront modal re-fetches the full product config on every open. A 5-minute cache (in-memory or Redis, or just `Cache-Control` headers on the proxy response) would save dozens of DB round-trips during a busy period.

### Performance

- **Client bundle splitting.** Konva should be lazy-loaded only when the modal opens, not on every storefront page load. Polaris React should be tree-shaken per-page. Use `npm run build` output to diagnose.
- **Presigned URL caching.** `getPresignedGetUrl` is called per placement — batch or cache for the modal's lifetime (S3 URLs have TTL but our issuance doesn't need to be per-request).
- **Konva offscreen canvas / requestIdleCallback.** The placement editor renders synchronously on every prop change. Profile it.
- **Image loading.** R2 presigned URLs with no CORS = canvas tainted. That's fine for display but blocks `toDataURL`. Confirm we don't accidentally hit that path.

### Observability

- **Structured logs.** Right now most logs are `console.log("[prefix] string")`. A minimum: prefix + tag + level. Consider Pino or a tiny wrapper.
- **Error reporting.** Is there a Sentry / error-tracking hook? If not, add one — Shopify dev-mode noise notwithstanding.
- **Metrics on the variant pool.** Slot utilization, grow events, P2002 retries — all should emit counters.

---

## Things you can safely rip out (on approval)

These are my guesses — verify before acting. Each needs the "surface before changing" step.

- **Superseded commits / stale branches.** See `.claude/worktrees/` — old feature branches sit around. Cleanup is cheap.
- **Duplicate docs.** `docs/notes/` has lots of one-off research. Some are now outdated vs. Tier 1 canonical docs in `docs/core/`. Audit for drift.
- **Dead routes.** `git log` + grep will find routes that haven't been touched in months and are no longer linked from anywhere. Examples I suspect: old admin debug pages.
- **Unused env vars.** Cross-reference `.env.example` (if it exists) against actual usage.
- **Legacy implementations.** The commit history shows at least one "v2 redesign" pivot — the v1 code path may still linger behind a feature flag or orphaned import.

---

## Tooling reminders

See `CLAUDE.md` for the full tool inventory. Critical ones for this mission:

- `mcp__shopify-dev-mcp__*` — for every Shopify API / docs question.
- `mcp__context7__*` — for React Router, Prisma, Polaris, Vite, anything not Shopify.
- `mcp__pencil__*` — if you want to mock up UI changes before proposing them. Good for the redesign phase.
- Superpowers: `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `code-reviewer`, `verification-before-completion`, `using-superpowers`.
- GitHub Actions — `.github/workflows/docker-publish.yml` runs typecheck + lint + Docker build on every push. Don't push anything that fails quality.

---

## First message template

When the next agent starts, respond with something like:

> I've read `CLAUDE.md` and `ARCHITECTURE_REVIEW_BRIEF.md`.
>
> Before I begin the audit, one question: **[the single most load-bearing clarifying question]**.
>
> Once you answer, I'll produce Phase 1 (the audit report at `docs/architecture-review/2026-AUDIT.md`). I'll not touch any code until you approve the P0/P1 findings.

Then stop and wait.

---

## History / context

- Latest `main` commit at time of writing: `3b85d06` (April 2026).
- Recently fixed: storefront modal close (Bug #2), upload-input overlay (Bug #3), P2002 on concurrent /prepare (Bug #1), reorder stepIndex validation, webhook TOML drift, CI quality-gate (Prisma.DbNull + eslint ignore for auto-regenerated d.ts).
- Known pending follow-up: `getShopByDomain` vs. `getOrCreateShopByDomain` asymmetry in webhook handlers (non-blocking).
- No active feature work — you are the only stream of changes going into `main`.

Good luck. Work methodically. Ask questions.
