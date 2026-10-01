# M5-003R2 execution evidence

[Correction report](../../M5-003R2-REPORT.md), [principal verdict](../../PR-029R-principal-review.md), [exact supplied package](principal-package/README.md), [baseline verification](baseline-verification.json), [commands/results](verification.json), [log provenance](log-provenance.json), [retained 100k bindings](retained-query-bindings.json).

## Red / green

- [Publication baseline RED](logs/r1t-public-http-red.log): public real-PG coordinator → actual adapter/transport → synthetic fetch sent one expired HTTP mutation.
- [Restoration baseline RED](logs/restore-public-http-red.log): composed adapter sent ACTIVE after readiness expired.
- [First vertical GREEN](logs/first-green.log): the two original public-seam tests pass after the dispatch correction.
- [Expanded matrix](logs/matrix-green.log): 24 publication rows, final real SQL/key read, three credential controls and initial restoration case pass. The final root/PG suites include the six expanded restoration rows.
- [Intermediate full activation run](logs/activation-green.log): two test expectations were corrected: actual HTTP acquisition is counted by its status mutation, and reverse-time recovery rejects its future snapshot. The failed run is preserved.
- [Intermediate strict fixture run](logs/strict-all.log): exposed invalid synthetic credential discriminant and pre-existing zero-argument spy inference. Typed external mocks and the actual `temporarily_unavailable` discriminant correct those fixture errors. [Final strict check](logs/strict-verified.log) is silent with exit 0.

## First candidate checks (retained history)

- [Full pinned root](logs/root-verified.log), including current Function builds/replays, architecture/history checks, browser suite, boundaries and secrets.
- [PostgreSQL18](logs/postgres-verified.log): 139/139, migrations applied twice idempotently.
- [HTTP/Admin](logs/http.log): 16/16 required tests, no skips.
- [Worker/queue](logs/worker.log): 15/15 required tests, no skips.
- [Shopify adapter](logs/shopify-final-typed.log): 226/226.
- [Stress](logs/stress.log): 100/100, 25 per combination, no retries/skips.
- [Renderer control](logs/renderer.log): missing renderer intentionally fails inner browser test; wrapper validates the expected rejection and exits 0.

Logs contain synthetic identities/credentials only. No owner secrets were read. Published logs remove ANSI controls, per-line trailing whitespace and final blank lines; raw/published hashes are separate. Existing historical evidence and supplied diagnostic hashes are unchanged. Fresh full-source reviews, selected actual read-only model/high launch contexts and all final exact-head CI are supplied in the PR packet after the candidate commit, avoiding self-referential head hashes in this commit. Source inspection is distinguished from executed checks. No local review is principal approval.

## Fresh-review correction and final local checks

Both first full-source reviews found the calendar-preparation interval: [Spec](reviews/first-spec.md), [Standards/security](reviews/first-security.md). [Launch provenance](reviews/first-review-provenance.json) records selected actual model/high/read-only settings. [First candidate CI](reviews/first-candidate-ci.json) was green but does not clear the later finding.

- [Public-PG calendar RED](logs/calendar-public-red.log): 14 failures, six controls; fixture hash recorded in verification.json.
- [Intermediate expectation correction](logs/calendar-public-green.log): four failing message expectations, 16 passing cases.
- [Retained midnight RED](logs/calendar-application.log): two retained calendar/key tests failed the first attempted fix.
- [Corrected public matrix](logs/calendar-public-final-green.log): all 20 cases pass.
- [Application](logs/calendar-application-final.log): 174/174, including both midnight controls.
- [Final root](logs/calendar-root.log); [strict fixtures](logs/calendar-strict.log), silent exit0.
- [Final PostgreSQL18](logs/calendar-postgres.log): 159/159; [HTTP](logs/calendar-http.log):16/16; [worker](logs/calendar-worker.log):15/15, no skips in required database tests.
- [Final stress](logs/calendar-stress.log):100/100, 25 per combination, no retries/skips.
- [Final renderer negative control](logs/calendar-renderer.log): expected missing-renderer inner failure, wrapper exit0.

All six query bindings were rechecked after the corrected build. Final fresh full-source review reports and exact-head CI are delivered in the fixed-head PR comment; these first reports remain findings, not final approval.
