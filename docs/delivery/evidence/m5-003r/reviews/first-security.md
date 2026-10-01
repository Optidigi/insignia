**One unresolved material finding: P2 — hold admission can expire before publication dispatch.** This candidate needs correction and fresh local review. The principal’s **CHANGES_REQUESTED** verdict remains controlling.

Verified local refs:

| Ref | Actual value |
|---|---|
| Base / merge-base | `8a84ddeaf277368852d224915abe6d4a93a3d8a4` |
| HEAD | `0c8e473f4ed38aa5a66c62f4a1602067ca500a44` |
| Tree | `5d15cf9887c16678ef67f131e519159a34928b30` |

The worktree was clean before and after review. The full `base...HEAD` diff was captured; `git diff --check` passed.

**Finding:** [production-publication.ts:605](https://github.com/Optidigi/insignia/blob/0c8e473f4ed38aa5a66c62f4a1602067ca500a44/packages/database/src/repositories/production-publication.ts#L605), with the dispatch at [line 702](https://github.com/Optidigi/insignia/blob/0c8e473f4ed38aa5a66c62f4a1602067ca500a44/packages/database/src/repositories/production-publication.ts#L702) and admission check in [production-activation.ts:85](https://github.com/Optidigi/insignia/blob/0c8e473f4ed38aa5a66c62f4a1602067ca500a44/packages/database/src/repositories/production-activation.ts#L85).

The availability observation becomes a boolean admission result. Publication then awaits three metadata reads and another database/current-key check before writing, without rechecking the observation’s age. This violates the corrected contract that stale admission must cause zero publication writes.

I reproduced this through the current TypeScript public facade, `createDurableCore(...).productionActivations.create(...).publications.advance(...)`, using in-memory SQL responses, synthetic availability and an injected clock:

| Metadata-read delay | Budget | Hold age at write | Writes | Result |
|---|---:|---:|---:|---|
| 0 ms | 1,000 ms | 0 ms | 1 | `PENDING / shop-config-written` |
| 2,000 ms | 1,000 ms | 2,000 ms | 1 | `PENDING / shop-config-written` |

No database or provider was contacted. The check required no RELEASE_BOUND premise.

**Necessary correction:** preserve the conservative observation origin through admission and validate its age immediately before dispatch, after intervening awaited work. Alternatively, obtain and validate a new owned-hold observation at that point. Preserve exact-boundary, future/reversed-clock and identity/drift safeguards. Add a public-facade regression delaying metadata reads after successful availability observation; the delayed case must dispatch zero writes. The current [R1 integration tests](https://github.com/Optidigi/insignia/blob/0c8e473f4ed38aa5a66c62f4a1602067ca500a44/packages/database/test/activation.test.ts#L411) delay availability fetch/body/credential work and do not cover this later interval.

The full-source scope reviewed included:

- Application activation, availability and recovery modules and their tests; trusted-release/artifact/readiness/public-key/lifecycle logic; publication projection and exports.
- Database public facade, durable core, activation/recovery/publication repositories and tests; interacting config, tenant, signing-key, publication-intent, accepted-quote and canonical-hash logic; the integrated M5 migration.
- Shopify hold/catalog source and tests, authentication, credential/deadline, Function identity and publication CAS/readback adapters.
- Web Admin composition, authorization/runtime/preview paths, merchant service, activation/release mapping, shared state, complete editor, changed Admin tests and browser publication/geometry tests; geometry and renderer paths.
- Root manifests/lockfile, relevant CI, dependency/public-facade/secret boundaries, build-runtime and renderer-control tests, and retained-history query script.
- Requested authority documents, both slice prompts/reports, evidence indexes/provenance, principal verdicts and historical findings. Earlier clean local reviews were treated as history.

R1’s origin/receipt separation and R2’s lossless UNLISTED handling are supported by source inspection and permanent regressions. Optional `receivedAt` remains additive; legacy timestamps are not rewritten or retroactively qualified. No SQL migration change occurred in the R correction. I found **no additional unresolved material finding** concerning the reviewed tenant/generation fences, public-facade opacity, release authority, immutable evidence, transaction boundaries, one-use restoration dispatch, recovery or secret/error containment.

Checks **I executed**:

- Git ref/status/diff/preservation checks and local evidence-hash audits.
- `node node_modules/typescript/bin/tsc -p packages/{application,database,shopify}/tsconfig.json --noEmit --incremental false` — three separate commands, all exit 0.
- `node --test apps/web/test/admin/activation-state.test.mjs apps/web/test/admin/release-evidence.test.mjs` — exit 0; two files passed.
- The corrected in-memory public-facade control/reproducer — exit 0. Initial harness setup failures were harness failures, not candidate test results.

Evidence **I inspected, without rerunning**: application 174, Shopify 221, PostgreSQL 97, HTTP 16, worker 15, root PASS, stress 100/100 with zero retries/skips, and renderer control/fixtures/style/secrets receipts. All 19 current sanitized-log hashes matched their manifest. All six retained query-plan bindings matched current artifacts; **no new query-plan measurement** was made.

No delegation, edits, builds, network/browser/provider operations, credential reads or database operations occurred. The supplied explicit model/high and read-only launch context is retained without claiming provider-private attestation.

There remains **no real all-channel or in-flight proof**, no native atomic status CAS, no production release source or RELEASE_BOUND record, and no qualification of DEV_PREVIEW_OBSERVED. G7 remains incomplete. This is local review, **not principal approval, an M5 pass or a gate pass**.