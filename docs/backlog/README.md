# Backlog

Work the owner has deferred, to pick up later. Each item says what to do, why, and what is decided so far.
Current status and deployed identities stay in [state.md](../delivery/state.md).
The [technical audit checklist](technical-audit.md) tracks every item from the 26 November report.

## Dependency updates

Updated 25 Nov 2026. There is no update automation: Dependabot was removed, and no workflow merges or opens dependency PRs.
Dependencies, GitHub Actions, Node, the Rust toolchain and pinned tools are updated by hand in one reviewed batch, then
qualified by CI and a fresh-store walkthrough before any deploy. The Astro 7.3 → 7.4 minor update in #575 passed every CI check
and still broke all admin saves in production (403 "Origin denied", 18 Nov), so a green CI run alone does not qualify an update.
Any future automation is an owner decision.

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

## AW validation findings

- Publishing a Shopify duplicate can reach the existing enforcement-field guard. The AW fixture copied both
  app-owned fields from its source. The editor displayed an unconfirmed request with Retry for the typed
  `422 PUBLICATION_UNAVAILABLE` support refusal. Surface that refusal while retaining reconciliation for
  genuinely ambiguous requests. See the [native evidence](../delivery/shopify-review-resubmission.md#deploy-aw-validation).
- The first Setup publish on each blank EUR product showed an inherited-defaults review and an unsaved-draft
  banner at the same time. The saved values were present on reload. Show one consistent draft state after
  the review pause.

## After the hardening pass (25 Nov 2026)

Added 25 Nov 2026 from the 24–25 Nov hardening pass ([evidence](../delivery/shopify-review-resubmission.md#remaining-hardening)).

**Open issues.**
- [#637](https://github.com/Optidigi/insignia/issues/637) uses the native product page's Shopify
  availability hint on AX. The split-inventory fixture showed the variant as
  unavailable on the Netherlands product page. The alternate Storefront API probe returned
  `Online Store channel is locked` for both countries. AX verified the sold-out warning before artwork and cleared the hint after stock restoration.
- #653 The isolated EUR Lighthouse series is still open. Use the [AW measurements](../delivery/shopify-review-resubmission.md#deploy-aw-validation) for the more recent USD results.

**Shipped fixes.**

- #643 Cart messages after compensated partial adds and throttled witness reads were fixed in #659 and released in AV.
- #651 The selected-repair Escape test was fixed in #654 and released in AV.
- #653 AY retains intent-only Designer loading.
- Guest artwork upload admission uses a two-second shop-lock timeout on AY ([#683](https://github.com/Optidigi/insignia/pull/683)).

**Fixed (owner approval 25 Nov 2026).** A publish step that started on a 25–30 s-old release record could be
refused mid-step; #641 and #650 narrowed the window. PR #658 closes it: a step reuses a record only while it
stays fresh for another 7 s (its measured write budget), otherwise it joins or runs a collection first.

**Deferred.**
- [#656](https://github.com/Optidigi/insignia/issues/656) targets first-publish p95 of 10 s or less. The
  isolated four-channel fixture took 69 serial Shopify rounds at 350 ms per round. The 14 availability
  observations alone took 42 rounds (14.7 s). A trial that overlapped the hold and field reads saved five
  rounds but allowed a policy write after the pending registration disappeared. The trial was reverted
  and the registration-drift regression was retained. Owner decision 3 keeps the current hold checks
  through approval. Production p95 remains unverified.
- AZ classifies catalog transport failures as retryable on safe reads ([#686](https://github.com/Optidigi/insignia/pull/686)).
- A persistent Shopify INTERNAL_SERVER_ERROR now shows as BUSY (warn) rather than unavailable (error) since #647.
- AZ verified journald retention across replacement for web and worker. Collect the 48-hour baseline.
