# M5-003R evidence index

All current provider transport and credentials are synthetic. No remote operation or owner credential read occurred. The [principal package](principal-package/README.md) retains its attributed fixed-source diagnostic and Node22 qualification; it was not substituted for tests of corrected source.

|Finding/seam|Red evidence|Corrected implementation|
|---|---|---|
|R1 complete availability port: fetch/body/post-credential age, receipt and clock bounds|r1-adapter-red.log:7 failing assertions|correction-shopify.log:221/221 including observe and mid-request mutation/readback|
|R1 realPG public publication admission|r1-public-pg-red.log:3 failed; delayed observations caused a policy write|r1-public-pg-green.log plus correction-postgres.log:97/97; stale calls stay admission-pending, zero policy writes/activation|
|R2 full catalog and hold ports|r2-status-red.log:3 failures|Mixed ACTIVE/UNLISTED list/detail, exact original restoration, unknown status and merchant-drift controls pass|
|R2 persisted public read/restart/activation/restore|r2-public-pg-red.log:1 failure|UNLISTED before/hold/evidence retained across realPG restarts, restored status sequence exactly DRAFT→UNLISTED|

`red-receipts.json` records stage, runtime, command and exit status. R1 red used the reviewed unchanged runtime; R2 red was the R1-corrected/R2-uncorrected intermediate, not falsely attributed to the complete old source. Focused reds deliberately select/skip unrelated tests; the final required suites do not turn PG/HTTP/worker cases into skips. `log-provenance.json` binds raw and sanitized bytes; formatting normalization changes no substantive output.

Complete pinned root: `correction-root.log` PASS, including current Rust/Wasm, browser, history, secrets and boundaries. RealPG18.6 full suite:97/97, with migrations run twice in isolated `insignia_m5003r_test`. HTTP:16/16 (`correction-http.log`); worker:15/15 (`correction-worker.log`); strict complete fixture compile:PASS; geometry stress:100/100,25 per combination,zero retries/skips (`correction-stress.log`). Missing renderer:normal expected-failure control PASS. Final style and secrets pass.

No SQL schema/query/read seam changed. `retained-query-bindings.json` verifies all six rebuilt source/output/migration hashes match the preserved [100001-row plans](../m5-003/query-plan.json). Existing disposable migration rehearsal remains applicable; final PostgreSQL CI runs its normal down/up gate. No new benchmark run or machine SLA is inferred.

Both fresh actual GPT-6.1-sol/high reviewers inspect FULL integrated corrected source against the same base and candidate. Attributed full reports, selected actual model/effort/read-only contexts, exact final refs and all applicable exact-head CI are returned in the PR packet after completion. Earlier clean local verdicts and subsequent principal findings remain preserved, not rewritten as principal approval.
