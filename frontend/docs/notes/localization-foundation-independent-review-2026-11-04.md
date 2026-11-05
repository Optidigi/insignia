# Localization foundation independent review

4 November 2026. Reviewed the shared localization runtime, native Preact bindings, audience entry points, admin shell readiness and navigation registration, customer artifact verifier, and frontend verification runner against [the localization plan](localization-implementation-plan-2026-11-02.md).

## Findings

No additional source defect was found in the reviewed foundation lane. The admin navigation remains inert inside an HTML template until `syncMetadata()` writes the current labels and inserts it into the document. This prevents App Bridge from observing stale navigation outside the iframe. Locale controllers keep state per instance, publish only the latest prepared request, and retain the active snapshot if preparation fails. Unsupported languages resolve to complete English UI and English formatting. Translation wrappers validate interpolation parameters, preserve supplied names and filenames, and return plain text for normal text-node or escaped-template sinks.

## Evidence

- `node --test apps/web/test/admin/localization-shell-browser.test.mts apps/web/test/admin/navigation-presentation-browser.test.mts`: 8 passed, 0 failed. This includes fallback metadata, Shopify locale precedence, isolated document controllers, delayed navigation registration, route reveal and back-forward-cache gates.
- `pnpm --filter @insignia/localization exec vitest run src/core.test.ts src/customer.test.ts`: 16 passed, 0 failed. This covers regional formatting fallthrough, controller isolation/latest-request behavior, interpolation validation, and preservation of merchant text in pseudo and regular copy.
- `node --test apps/web/test/admin/preview-order-ordering.test.mts`: 3 passed, 0 failed after updating the Home assertions to the semantic order fields. This is adjacent verification, not part of the foundation review.
- `pnpm exec i18next-cli lint --config packages/localization/scripts/i18next.config.mts`: 174 files analyzed, no findings. At the review snapshot, the companion AST source check still reported 23 raw copy sinks in the selected placement workflow preview support component; those exact lines were sent to the admin migration owner, including one hidden host-only sink for scope disposition.
- `scripts/ci/localization-artifact.mts --clean-install` now copies the selected buyer to a disposable directory without existing dependencies or build output, then runs `npm ci` and the strict production build against the relative vendor artifact. `scripts/ci/frontend-state.mts` invokes this check.

## Pending verification

The clean customer install and build have not been executed yet. Root is waiting for the final canonical customer catalog artifact sync before running the full check. The last `astro check --minimumSeverity error` snapshot at review time still returned 26 diagnostics in in-flight admin integration files; the Home ordering property errors fixed in this task were absent. See `.artifacts/localization-implementation-2026-11-03/admin-test-types.log` for that snapshot. This review does not claim a clean global build, native Shopify observation, visual acceptance, or release approval.

## Root verification addendum

The pending items above describe the reviewer's earlier snapshot. Final canonical source/copy checks, all 39 effective compiler projects, both frontend builds and the disposable customer archive clean install subsequently passed. The consumer now uses `insignia-localization-0.1.0-1f7aed7ae1e28b6f.tgz`. Root's [final implementation record](localization-implementation-2026-11-04.md) and [verification receipt](../../../.artifacts/localization-implementation-2026-11-03/verification-receipt.json) report the broad regression run and passing complete reruns of repaired test files. This addendum is root's execution report, not a claim that the independent foundation reviewer performed those later runs. Native Shopify, hosted customer source acquisition and release acceptance remain separate.
