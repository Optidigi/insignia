# Backlog

Work the owner has deferred, to pick up later. Each item says what to do, why, and what is decided so far.
Current status and deployed identities stay in [state.md](../delivery/state.md).

## Dependency updates: what merges automatically

Added 18 Nov 2026. Owner: revisit after the App Store submission.

**Why.** Dependabot (`.github/dependabot.yml`, #575) opens grouped weekly PRs, but nothing merges them. Merging everything
automatically is unsafe: the Astro 7.3 → 7.4 minor update in #575 passed every CI check and still broke all admin saves in
production (403 "Origin denied" from 04:33Z to 13:24Z on 18 Nov; fixed by #588, deploy AE). A merge does not deploy, but whatever
sits on main goes into the next production deploy without review.

**Proposal (not yet decided):**
1. Auto-merge only GitHub Actions minor/patch updates and npm dev-dependency patch updates, once the required checks (`foundation`,
   `durable-core`, `runtime`) pass. Needs repository auto-merge enabled (off on 18 Nov) and a small workflow using
   `dependabot/fetch-metadata` plus `gh pr merge --auto --squash`.
2. Runtime dependencies (Astro, Preact, sharp, Shopify libraries, i18next, Rust crates in the Functions and signer) and every
   major update: manual review, merged as one batch before a planned deploy, with a fresh-store walkthrough before production.
3. Security advisories: handled promptly, case by case.

**Open Dependabot PRs on 18 Nov (left open; no dependency changes until the app is approved):**
#578 actions/download-artifact 8, #579 actions/checkout 7 (CI fails), #580 actions/setup-node 7, #581 cargo minor/patch group,
#582 base64 0.23, #583 npm minor/patch group of 19 (CI fails), #584 preact 11 (CI fails), #585 i18next 27.

## Admin rough edges from the fresh-store walkthroughs

Added 18 Nov 2026. Found by the agent during the review-readiness walkthroughs (`insignia-review-20261118-1522`,
`insignia-final-20261118-1840`); none blocks review. Owner review before any is picked up.

- Archived Shopify products still show as "Published" in the Insignia product list.
- Two products with the same title look identical in the product picker (no handle, image or status to tell them apart).
- The measure tool only appears when the placement uses "Shared image".
- A product shows "Not offered" until at least one method has a price, without saying why.
- The `chooseMethods` URL parameter is left over after #592 removed method assignment; remove it and its handling.

## Server refactor input (Insignia)

Added 19 Nov 2026. The owner plans a server-wide refactor of app and database naming after the App Store review. Insignia's
leftovers to fold into it (each needs a restart, so they were not done during review):

- **Old database alias `insignia-rewrite-m5-019-database`.** Pinned in `deployment/release-verifier/artifact.mts` (startup
  file host), `scripts/release/collector-native.mts`, their tests (`scripts/ci/release-verifier-artifact.test.mts`,
  `scripts/release/owner-boundaries.test.mts`, `scripts/runtime/production-compose.test.mts`) and the verifier README; the
  live `secrets/verifier-startup.json` uses it. Change: code and tests to the new host name, new verifier image, startup file,
  then remove the alias from `deployment/production/compose.yaml`. Removing an alias recreates the database container
  (about one minute offline with its clients). The owner's `/srv/ops/infra/scripts/backup-server.sh` lists the alias only
  in its Insignia skip rule.
- **Database and role name `insignia_rewrite`** (`POSTGRES_DB`/`POSTGRES_USER`, every connection string, the verifier and
  collector pins). Renaming needs an outage and every URL changed; do it only as part of the refactor.
- **Fixed address `10.0.7.250`**: the host artwork inspector (`/srv/data/saas/insignia/artwork-inspector/inspection.env`)
  reaches the database by IP; keep a fixed address or give the inspector another route.
- **Names to choose with the refactor's convention:** Compose project and containers `insignia-*`, networks
  `insignia_private`/`insignia_*-egress`, stack `/srv/saas/infra/stacks/insignia`, data `/srv/data/saas/insignia` (LUKS
  mount, crypttab and fstab: root), bucket `insignia-production`, and the planned staging stack (working name
  `insignia-staging`). The repository folder `deployment/m5-runtime` and the retained `deployment/m5-019*` records are
  historical names only.

## After the hardening pass (25 Nov 2026)

Added 25 Nov 2026 from the 24–25 Nov hardening pass ([evidence](../delivery/shopify-review-resubmission.md#remaining-hardening)).

**Open issues.**
- #637 Market-aware stock check before quoting (owner decision 6: deferred until after App Store approval).
- #643 Misleading cart messages after compensated partial adds and throttled witness reads (fixed by its PR).
- #651 Flaky selected-repair Escape test (fix in PR #654).
- #653 Storefront performance: idle Designer prewarm (~200 KB JS + 234 KB CSS), USD TBT +238 ms, USD footer
  CLS 0.15. Lighthouse 25 Nov: USD −7.0 points (pass is 6, Shopify's limit 10), EUR −1.5.

**Waiting for an owner decision.** A publish step that starts on a 25–30 s-old release record can still be
refused mid-step. #641 and #650 narrowed the window; closing it changes a freshness rule.

**Deferred.**
- Relax the publish hold-safety steps to reach ≤10 s first publish (options A/B in #632's analysis); owner
  decision 3 defers this until after approval. First publish took 25–38 s in production before #641.
- The guest artwork upload shop-lock wait is unbounded (other buyer waits are bounded at 2 s by #639).
- Catalog-transport network failures are not typed yet: they return 503 instead of BUSY.
- A persistent Shopify INTERNAL_SERVER_ERROR now shows as BUSY (warn) rather than unavailable (error) since #647.
- Persist production logs: on 24 Nov they reached back only to container restarts, so no 48 h latency
  baseline exists.
