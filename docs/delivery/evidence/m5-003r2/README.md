# M5-003R2 execution evidence

[Correction report](../../M5-003R2-REPORT.md), [principal verdict](../../PR-029R-principal-review.md), [exact supplied package](principal-package/README.md), [baseline verification](baseline-verification.json), [commands/results](verification.json), [log provenance](log-provenance.json), [retained 100k bindings](retained-query-bindings.json).

## Red / green

- [Publication baseline RED](logs/r1t-public-http-red.log): public real-PG coordinator → actual adapter/transport → synthetic fetch sent one expired HTTP mutation.
- [Restoration baseline RED](logs/restore-public-http-red.log): composed adapter sent ACTIVE after readiness expired.
- [First vertical GREEN](logs/first-green.log): the two original public-seam tests pass after the dispatch correction.
- [Expanded matrix](logs/matrix-green.log): 24 publication rows, final real SQL/key read, three credential controls and initial restoration case pass. The final root/PG suites include the six expanded restoration rows.
- [Intermediate full activation run](logs/activation-green.log): two test expectations were corrected: actual HTTP acquisition is counted by its status mutation, and reverse-time recovery rejects its future snapshot. The failed run is preserved.
- [Intermediate strict fixture run](logs/strict-all.log): exposed invalid synthetic credential discriminant and pre-existing zero-argument spy inference. Typed external mocks and the actual `temporarily_unavailable` discriminant correct those fixture errors. [Final strict check](logs/strict-verified.log) is silent with exit 0.

## Complete applicable local checks

- [Full pinned root](logs/root-verified.log), including current Function builds/replays, architecture/history checks, browser suite, boundaries and secrets.
- [PostgreSQL18](logs/postgres-verified.log): 139/139, migrations applied twice idempotently.
- [HTTP/Admin](logs/http.log): 16/16 required tests, no skips.
- [Worker/queue](logs/worker.log): 15/15 required tests, no skips.
- [Shopify adapter](logs/shopify-final-typed.log): 226/226.
- [Stress](logs/stress.log): 100/100, 25 per combination, no retries/skips.
- [Renderer control](logs/renderer.log): missing renderer intentionally fails inner browser test; wrapper validates the expected rejection and exits 0.

Logs contain synthetic identities/credentials only. No owner secrets were read. Published logs remove ANSI controls, per-line trailing whitespace and final blank lines; raw/published hashes are separate. Existing historical evidence and supplied diagnostic hashes are unchanged. Fresh full-source reviews, selected actual read-only model/high launch contexts and all final exact-head CI are supplied in the PR packet after the candidate commit, avoiding self-referential head hashes in this commit. Source inspection is distinguished from executed checks. No local review is principal approval.
