# Exact source / evidence index — read LIVE repo, not cached assumptions

**Pin initial read to approved PR54 head** `c7bbca723179e908553b6f8e786a9b638e9bf6a8`; after normal merge, use actual merge/main SHA. Project repo `Optidigi/insignia`. Every path below is present or identified from the current repository state; recheck filename/layout before editing.

## Entry, authority, handoff

- `AGENTS.md` — latest active stop and delivery entry.
- `docs/architecture/decision-ledger.md`, `docs/architecture/implementation-plan.md` (M3, M5, G7, M10/M11 and §14–16).
- `docs/delivery/operating-model.md`, `docs/delivery/state.md`, `docs/delivery/templates/review-packet.md`.
- `docs/delivery/prompts/M5-023-INSTALL-BOOTSTRAP-TRUSTED-PROVISIONING.md` — historical authority only.
- `docs/delivery/PR-053R-principal-review.md`, `docs/delivery/evidence/m5-023/pr53-merge-receipt.json`.

## Immediate stop, proposal, operator evidence

- `docs/delivery/M5-023-REPORT.md`, `M5-023-G7-MATRIX.md`, `M5-023-PRODUCTION-PLAN.md`.
- `docs/delivery/M5-023-UNINSTALL-PROCESSOR-PROPOSAL.md` — **required**.
- `docs/delivery/M5-023-OFFLINE-CREDENTIAL-INVENTORY.md`.
- `docs/delivery/evidence/m5-023/lifecycle-settled.json`, `closed-accounting.json`, `host-readonly-outcome.json`, `access-closure.json`, `frozen-preproduction-gate.json`, `final-integration-continuity.json`.
- `docs/delivery/evidence/m5-023/operators/host-operator.py`, `host-operator-controls.py`, `expected-compose.yaml`, `worker-inventory.mjs`, `worker-inventory-controls.mjs`, `worker-loss-before-image-control.py`, `runtime-database.mjs`.
- `docs/delivery/evidence/m5-023/operators/Dockerfile` (reviewed M5 web image, **not automatically a worker Dockerfile**).
- Final head PR54 comment: https://github.com/Optidigi/insignia/pull/54#issuecomment-6068583551.

## Worker and pg-boss (M5-024 nucleus)

- `apps/worker/src/main.ts` — Node entry, exact credential requirements, worker start, 30-second periodic recovery, signals.
- `apps/worker/src/runtime.ts` — `WEBHOOK_QUEUE`, `REFRESH_QUEUE`, `createPgBossRuntime` and `boss.start/createQueue`, retry/dedupe/resume.
- `apps/worker/src/config.ts` — wrapping-key ring and previous key bounds.
- `apps/worker/src/handlers.ts` — processUninstall, expiring offline refresh, unresolved-uninstall recovery.
- `apps/worker/src/process.ts`, `health.ts`, `diagnostic.ts` — bounded lifecycle and loopback readiness.
- `apps/worker/package.json` — pinned Node24.21.0 and **pg-boss 12.35.0**.
- `apps/worker/test/runtime.test.mjs` and other actual `apps/worker/test/` suites — inventory actual cases before adding tests.

## Web ingress, database and identity

- `apps/web/src/pages/api/webhooks/shopify.ts` — webhook verifier/producer and queue handoff.
- `apps/web/src/server/shopify-webhook.ts`, `apps/web/src/server/runtime.ts` — HTTP + queue runtime composition.
- `packages/shopify/src/webhook.ts` — raw-body HMAC; metadata header parsing.
- `packages/shopify/test/webhook.test.ts` — verifier controls.
- `packages/database/src/repositories/shopify-webhooks.ts` — immutable inbox and durable `processUninstall`, late binding, generation fences.
- `packages/database/src/repositories/tenant.ts` — managed-install ensure, generation/credential deactivation.
- `packages/database/src/repositories/shop-credentials.ts`, `packages/database/src/credentials/envelope.ts` — existing encrypted expiring-offline lifecycle.
- `packages/database/migrations/20260929000100_durable_core.sql`, `20260929000200_runtime_ingress_credentials.sql`; `20261008000100_m5_trusted_release.sql` for untouched M5-023 later dependency.
- `packages/database/test/managed-installation.test.ts`, `apps/web/test/admin/managed-install-bootstrap.test.mjs` — race regressions.

## Unchanged future work

- `apps/web/src/server/admin/production.ts` / `release-evidence.ts`, `packages/database/src/repositories/trusted-release.ts` — do not alter without direct demonstrated need.
- `packages/application/src/publication/activation.ts`, `packages/shopify/src/availability-hold-v3.ts`, `packages/database/migrations/20261007000100_m5_availability_v3.sql` — accepted activation/Availability v3 semantics; **no redesign**.
- `.agents/skills/writing-for-agents/SKILL.md`, `tdd`, `diagnosing-bugs`, `code-review`, `handoff` — existing pinned skills and mechanics; keep one operating model.

**Pattern for pinned read:** `https://github.com/Optidigi/insignia/blob/c7bbca723179e908553b6f8e786a9b638e9bf6a8/<path>`. Use actual merged main after merge and record new sha on first successor commit.
