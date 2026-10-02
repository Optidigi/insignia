# M5-008S-CI1 — PR #38 correction

## Authority and fixed inputs

[Principal review](PR-038-principal-review.md) is attributed external **CHANGES_REQUESTED**, accepting the M5-008S Shopify result but rejecting the old CI head. [Correction authority](prompts/M5-008S-CI1-DETERMINISTIC-TEST-CORRECTION.md) permits this local test correction on the same PR only.

Verified entry: base/effective merge base `d3adffdd7ea6c538016ac3569d1f17e81259aa89`, head `a1f0472116616bd583265f550b894df581630b32`, tree `6fab7c8e2db71d99b5e65e96a944ec37f9ac9398`; worktree was clean. Supplied package SHA256 `d51603cc5f45e993122e888e3a613e69bdffdb27e610448ef7d2d195476db6ed`, manifest 5/5 verified.

## Red and correction

Original Foundation run [37048061147](https://github.com/Optidigi/insignia/actions/runs/37048061147) remains failed at attempt 1 on the original head. Its retained failure is the post-dispatch timeout scenario racing preparation at 15 ms. It was not rerun or replaced by attempt-2 evidence.

The sole source change is `deadlineMs: 15` → `1000` in `ignored abort and late HTTP completion remain UNKNOWN with no later request or evidence rewrite`. Delayed fetch, assertions and late-response checks are byte-for-byte retained. The adjacent credential-preparation expiry remains 15 ms. Complete-file comparison proves the one-line scope. Production `diagnostic.mjs` remains blob `98903ae9226fe3ace6c77141b4936401178cc068`; corrected test blob `5aacc470f96a37da129faf53bf93f261c31658f6`.

## Green evidence

- [20 sequential named executions](evidence/m5-008s-ci1/named-test-results.json): 20/20, no retry wrapper; every process exited 0 and TAP reported exactly one pass, zero failures. Pinned Node 24.21.0.
- [Required command chain](evidence/m5-008s-ci1/chain-results.json): operator suites 6 + 33 + 49 passed; geometry/publication stress 100/100 with no retries, 25 per combination; missing-renderer negative control correctly rejected the absent renderer, outer verification exit 0. Retained chain stdout chunks are partial; no complete raw-capture claim.
- [Root/style suite](evidence/m5-008s-ci1/root-results.json): `corepack pnpm check` exit 0, including style, build, unit, operators, vectors, boundaries, secret checks, Rust/Wasm replay, browser, history and artifact checks. Initial local attempt stopped at missing default `cc`, exit 101; the documented retained process-local Zig linker completed the suite. No host change. DB-gated tests were skipped locally and await applicable natural CI.
- [Preservation](evidence/m5-008s-ci1/preservation.json): all 18 original accepted M5-008S report/prompt/evidence records retain their hashes. The closed remote register is unchanged. No Shopify/provider/browser/credential operation occurred in this correction.

Actual GPT-6.1-sol/high orchestrator and repository-pinned diagnosing-bugs, tdd, code-review, writing-for-agents and handoff were used. Final candidate refs, fresh restricted reviewer reports/settings and natural exact-head CI results are returned in the PR review packet; local reviews do not supply principal approval.

## Remaining boundary

The accepted historical insignia-2 / optional write_products result is preserved without re-observation. No product access qualification, preview cleanup, RELEASE_BOUND evidence, activation, full gate or launch claim follows. PR #38 stays open for principal rereview; no merge is authorized.
