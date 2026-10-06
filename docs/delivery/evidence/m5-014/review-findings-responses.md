# M5-014 full-source round1 findings and responses

Reviewed base55060c5a48617a27858d10fb0db639c7e9efe148/head e75c300ca65e4c9580c9db196a396801e7101cad. Preserve both complete reports unchanged. Both actual GPT-6.1-sol/high read-only/never runtimes independently verified.

Spec: three findings (P1 runtime fixture v1, P2 SQL nested evidence-version fence, P2 synthetic original-state recovery reset). Standards/security: two P2 findings (same runtime/recovery fixtures), no additional concrete production-security finding.

Recovery fixture: commit9f50fdd resets original complete intent/digest before the mismatched-authority assertion. Prior PostgreSQL18 natural attempt1 had160/161 passing; failure was the wrong fixture precondition, not waiver of authority.

Runtime fixture: selects explicit v2 factory, complete synthetic root Publications and read_publications grant, asserts evidence/hold version2. No production/runtime activation is performed.

Nested SQL evidence versions: new public persistence regressions first require rejection of v2 evidence embedding v1 hold/snapshot or a changed intent digest. Natural PostgreSQL18 run37507081718 at b2a154b0fb6f2331d86b3f1eaec8dd25c86f5f3b supplies the semantic red: the mixed-version INSERT unexpectedly resolves. An earlier run stopped at duplicate test-variable/style setup; sql-mixed-version-red.log is that setup failure, not a behavioral red. Source47fcce934b1d0b5e56f1eb8cc6768c9f47ceff1c restores v2-only nested version/identity/semantic fences after the demonstrated red, while leaving genuine historical v1 predicates/JSONB unchanged. It also exercises actual historical v1 observation-only trusted recovery and exact JSONB roundtrip. Final PostgreSQL green/reviews are recorded separately. Fresh full-source round2 is required after the correction.

The parent moved HEAD while initial reviewers worked only for the DB fixture correction; both reviewers explicitly rechecked findings against fixed-head git show. Their results remain bound to that initial candidate and are not relabeled as final-head reviews. No objections are waived.

Additional orchestrator regression: scheduled/staged dates changing between pagination pages were accepted with equal effective semantics. The public v2 snapshot test demonstrated red; the adapter now compares retained staged evidence between pages and returns readback_mismatch. Publish-date changes on currently effective membership remain diagnostic and still restore successfully.
