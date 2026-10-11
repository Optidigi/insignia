# M5 admin presentation and status checks

## Scope and acceptance

Local within-M5 correction from merged PR81/main `b45d99a739f2e98fb01685944a37bab5d07413ef`, accepted source tree `37ef5f320b0a30ef995b05785162140f02fc7baf`. Apply the existing Polaris/Preact contract, preserve authentication/provider/mutation authority, and distinguish failed status reads from unresolved writes. M5/G7 remains NOT_PASSED.

## Observed evidence

Owner normal-browser Search succeeded and displayed existing ARCHIVED historical products. This is an owner text attestation, not a screenshot or provider artifact. Qualified bounded server/database reads separately prove successful online exchange, current provider installation, created then reused active generation1 and exact designated Shop. The prior failed Search and unknown original cause remain historical facts; success does not retrospectively diagnose that cause. The old exposed client secret was owner-revoked and separately read back absent; current web/worker use only the replacement. No new version/release or secret rotation is part of this correction.

The owner then reported “readiness could not be checked” and “signing setup result is uncertain” after two status buttons. Server safe stages show authentication success for subsequent requests, but do not identify every browser scopes/query outcome. The exact owner readiness failure cause is not established by local route analysis alone.

Shared-browser public page inspection proves pinned Polaris loaded and registered components, while Shopify CDN fonts were denied by missing `font-src`. Native picker controls/plain product entries were visually incomplete. This correction adds only the Shopify font origin, Polaris search/navigation/cards/status, and responsive setup layout; no beacon or broader script/connect CSP authority is added. Product IDs remain internal rather than being displayed in the catalog.

## Reproduced defects and correction

The UI requested `/api/admin/products/readiness`; the actual Astro endpoint is `/api/admin/readiness`. Existing browser mocks repeated the wrong URL. Update both production callers and tests to the actual route. The test separately calls the real built route without configured runtime services and requires fail-closed503; this local no-runtime condition is not native authentication evidence. Existing permission gestures, exact two read scopes, one request, refreshed ID token, bounded401 retry and403/503 stop remain unchanged.

Signing status GET503 was incorrectly rendered as an uncertain setup result even before POST. The exact native fixed owner-plan file and durable signing directory are absent. The server consequently has no signing owner action configured. The UI now reports status unavailable and says the check did not start setup. An actual attempted POST followed by failed recovery remains UNCERTAIN, with no second POST. No signing key was created by these owner status checks.

## Qualification

Use the pinned diagnosing-bugs/TDD skills. The public seams are the real built Astro/Polaris browser and authenticated HTTP transport, plus actual response CSP. Presentation RED used missing font directive and absent visible card boundary; private input-height assumptions were rejected. Presentation controls passed at1280/390/320 widths. Signing read-only error regression failed before correction, then passed; unresolved-write control proves GET→POST→GET followed only by GET recovery. Readiness mock corrected to the real route failed before production caller correction, then passed. The first real-route assertion incorrectly expected401 from an unconfigured local server; corrected to the actual fail-closed503 contract and moved inside cleanup. Preserve this test refinement; it is not native auth success.

Focused corrected status/permission tests:4 PASS,0 FAIL. Presentation-only full web baseline:81 PASS,26 existing environment-dependent skips,0 FAIL. Final integrated web suite:83 PASS,26 existing environment-dependent skips,0 FAIL. Build, style, boundaries, secret and whitespace checks passed; see [local checks](local-checks.json). Independent reviews and natural exact-head CI remain required before acceptance/deployment.

## Remaining readiness work

The original reviewed signing overlay already allows exactly a read-only fixed private plan and a writable durable journal; current web has neither. Allocate exact tenant/installation/authorization binding and valid key/day metadata through qualified packaging, preserving the journal across recreation/rollback. No synthetic test key/day, unsigned release authority, blind Function creation or empty-journal restore is accepted. Obtain current authorized read grants/Function observations, strict30-second trusted release record, trusted merchant-local day and legitimate commercial eligibility before signing/publication. Do not configure the archived products.

No product/config fixture, signing mutation, scope change, provider write, deployment or SQL provisioning occurred in this local correction. Full uninstall/privacy obligations remain a separate required M5 acceptance row. See the original [G7 worklist](../m5-native-readiness-support/G7-WORKLIST.md) and [private receipt index](native-receipt-index.json).

## Continuation qualification

Current candidate `7dcd99ab9971164f459fc98b2069b24ec3bb0a4f` completed ten successful workflows and foundation run `38145083304` failed at attempt1. Its signing HTTP fixture used a fixed noon session while the real HTTP boundary checked wall time; the foreign-origin case therefore reached expired-actor401 before origin403. The focused original command reproduced401/403 failure locally. Pinning the HTTP test's Date to the existing fixture clock preserves expiration enforcement and all independently expected rejection statuses; all12 signing action controls then passed. Production authentication is unchanged. Preserve the failed run, rather than rerunning it as qualification.

Remove the second foundation invocation of `test:m5-operator`: `pnpm check` already runs that exact suite. Geometry stress and renderer controls still run separately. This removes demonstrated execution duplication without dropping a distinct assertion or changing workflow applicability. The maintained executable-footprint baseline and remaining reductions are still pending; this is not a claim that the50% ceiling or M5/G7 has passed.
