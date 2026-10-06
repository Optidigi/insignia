# M5-015 — stopped live qualification; offline harness evidence

## Outcome

**STOPPED_PRE_CREDENTIAL_GATE_BREACH.** M5-015 does not establish live Availability Hold v2 qualification. The pre-request offline gate was breached during development; live execution stopped before protected credential access or product creation. The corrected harness and its synthetic results are evidence for principal review, not authorization to resume this slice.

The supplied [external PR #44 approval](PR-044R-principal-review.md) matched the exact reviewed refs. All ten exact-head, attempt-one workflows passed before the owner-authorized normal merge. Actual merge `245be82fd3dd3a0dbe808cb65340ce16e1caa503` has ordered parents `55060c5a48617a27858d10fb0db639c7e9efe148`, `02e45926529fed9659e1c3dca81dec5f5ebe3174`, and tree `8c906e854b9cadcb8e9eda2740a0098067a71ad0`. Remote main matched it before M5-015 began. [Merge receipt](evidence/m5-015/pr44-merge-receipt.json), [reviewed-head workflows](evidence/m5-015/pr44-workflows.json), [authority package](evidence/m5-015/authorization/README.md).

## Offline-gate incident

The first implemented tracer passed `fetch: op.fetch` to `createShopifyAvailabilityHoldV2Port`; the production factory accepts `fetchImpl`. The factory therefore selected global fetch. One test execution and a diagnostic import that ran the test plus a separate diagnostic execution each attempted an initial snapshot and a cleanup-prestate snapshot. All six adapter reads returned `unauthorized`, using only a synthetic token and synthetic product GID `gid://shopify/Product/202` on the designated development domain.

These reads bypassed the experiment transport and its register accounting. The count of six is reconstructed from the three executed paths and their unauthorized failures; individual raw HTTP receipts were not captured. They consume six of the brief's 96 GraphQL attempts. This missing transport-level audit is part of the incident, not proof of a conforming gate. Auth exchanges and provider mutation attempts were zero; the auth/create replies in those development runs came solely from the in-memory mock. No protected credential was read, no real fixture was created, and no historical fixture was targeted.

[Incident record](evidence/m5-015/offline-gate-incident.json) records the deviation without treating documentation as approval. The corrected factory call uses `fetchImpl: op.fetch`. New tests replace uninjected global fetch with a local failure; child-process tests forward fixed requests only to a parent loopback mock. The live `qualify` entry point unconditionally stops before credential loading. Canonical `/home/serveradmin/insignia-m5-015-handoff/run` was not initialized. There is no live register, live fixture cleanup obligation, live ACK, or live lifecycle receipt.

## Corrected offline harness

Only new `scripts/m5-015`, root check registration, current instructions/state and evidence were changed. Production packages, migrations, v1/v2 adapter source and historical recovery remain identical to the PR #44 merge. The production factory supplies snapshot/acquire/observe/restore and the production application contracts supply validation and semantic equality. The harness extracts exact static documents from the production source, fences the fixed development app/shop/installation and current required grants, and records additional valid grants.

Synthetic lifecycle tests create one marker-owned DRAFT product, stage ACTIVE once, fsync an exact v2 intent, acquire once, preserve returned hold bytes/hash, terminate and reload in a genuinely different Node process, observe once, restore once, and archive once. A full synthetic path uses auth2/GraphQL22/create1/direct-status2/adapter-status2. Experiment-local installation generation `1` is only a fixture scope label; it asserts no production activation-state persistence or current database generation.

Regressions cover zero-effective ACTIVE as PARTIAL, real schedules as unqualified, naturally future-capable and non-future-capable included publications, exact identity/grant/ownership fences, intent drift, incomplete connections/repeated cursors, one-second ACK/readback diagnostics, lost create/acquire/restore responses, one exact-marker create recovery lookup, replay/reentry denial, global ceilings, serial requests and non-quiescent timeout quarantine. No publication mutation document is admitted. Synthetic full success is explicitly labelled `PASS_V2_SYNTHETIC`; no mock result is `PASS_V2_LIVE` evidence.

## Checks

The initial stub tracer genuinely failed before implementation: expected PARTIAL, got STOPPED. [Red](evidence/m5-015/partial-tracer-red.log). After correcting transport injection, the same tracer passed with uninjected network access denied. [Green](evidence/m5-015/partial-tracer-green.log). The initial implementation's unauthorized failures are the incident above, not an expected TDD red or a production defect.

Executed check receipts are recorded in [qualification summary](evidence/m5-015/offline-qualification.json). Two full local root runs passed; the final resume-order correction then passed all 28 focused regressions plus style/secrets. Exact-head CI reruns the complete root check. Applicable full root regression includes original v1/v2 and recovery tests, new operator/binding regressions, style/secret/boundary checks, Rust/Wasm vectors, production replay and browser regressions. Serial publication stress passed100/100; renderer control correctly rejected a missing renderer. The earlier stress failure during an overlapping build is retained. Focused v1/v2 adapters170 and recovery20 passed. Local PostgreSQL was attempted and failed because DATABASE_URL is unavailable; PostgreSQL18 coverage must be inspected from this PR's natural exact-head CI, not borrowed from PR #44.

[Production/harness source/build fingerprints](evidence/m5-015/source-build-verification.json) verify the unchanged production baseline. No satisfied live gate is claimed.

Fresh completed-change independent GPT-6.1-sol/high Spec/correctness and Standards/security reviews, actual read-only/never settings and final exact-head attempt-one CI belong in the external SHA-bound PR packet. No reviewer or CI result grants retrospective live authority.

## Remaining evidence and review boundary

Every M5-015 live lifecycle requirement is NOT_RUN: owned fresh fixture, complete live DRAFT/ACTIVE intent, real effective membership transition, durable live hold, acquire HELD, fresh-process live observe, restore and final ARCHIVED readback. Live future-capability coverage is NOT_RUN; neither prescribed observation flag is established from a live projection. Live ACK/readback deltas are unavailable. No production activation, RELEASE_BOUND, G7, complete G6/M5 acceptance, schedules, native CAS/race exclusion or launch is proved.

All 39 prior canonical file hashes match the [baseline](evidence/m5-015/prior-canonical-baseline.json); historical raw records and the permanently archived M5-010 fixture remain closed. No store operation followed containment. Return one evidence PR and stop for principal adjudication of the incident, corrected harness and the authorization needed for any future live attempt. Do not merge the successor PR.
