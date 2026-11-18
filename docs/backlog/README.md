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
