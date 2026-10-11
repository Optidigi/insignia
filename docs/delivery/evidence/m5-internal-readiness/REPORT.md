# M5 internal readiness and qualification cleanup

Base: verified PR82 normal merge `0bd6ab30bdd60dbd0d3feb85b058509d7a984970`, tree `cc9785ebc24c33f79377e3ae8b3999981015b349`. This is an internal M5 implementation candidate. It is not M5/G7 acceptance and is not yet deployed.

## Merchant behavior and internal preparation

The product editor no longer renders signing setup. The unused setup widget, its browser request helper and their widget-specific tests are removed. The authenticated private operator endpoint remains available to engineering; no status GET, editor mount, read, create or save initializes signing.

The maintained signing action and provisioning implementation are now checked TypeScript with concrete existing application/database/Shopify ports. Historical fixed CLI/core bytes remain unchanged. Runtime app identity comes from the existing reviewed deployment binding; that binding is neither a credential nor trusted release authority. Append-only trusted release evidence, exact current authorization/install generation, Function ownership/build, strict30-second freshness, original key custody, public-config CAS/readback and no ambiguous retry remain required.

An eligible new publish command may invoke internal preparation using only its verified actor's ephemeral request token and a private startup allocation. No browser-supplied plan or release record is accepted. Preparation must settle PROVISIONED before an immutable publication intent is created. Existing installations without an allocation still pass through the ordinary activation readiness gates; the absence of an allocation does not prove readiness. Durable publication replay does not initialize signing again. Production activation and its effective-revision contract remain unchanged.

The separate native prefixture readiness gate remains mandatory. Native signing allocation/initialization must be completed and evidenced before the permitted merchant-flow fixture; the publish hook does not waive that gate. Shared-browser navigation currently reaches Shopify login, so normal-owner-browser acceptance remains necessary. No login workaround or credential capture is introduced.

## Test seams and RED/GREEN evidence

The authorized seams are the maintained signing action, actual PostgreSQL merchant publication service and built merchant browser. A new action control failed because internal prepare did not exist, then passed with exact durable one-shot reuse. A PostgreSQL control failed because failed preparation still admitted publication, then passed with no publication intent/provider write. Existing ambiguous public-config settlement controls now also exercise prepare; uncertainty remains non-retriable. The built editor initially rendered the technical button, then passed after removal with zero signing requests. Existing signed-staff production composition, compatibility, authorization, origin, late-state, generation and activation controls remain.

Signing provisioning tests reuse the existing synthetic boundary fixture instead of keeping a second copy. The original CLI input-rejection and historical body-integrity controls remain distinct. Preliminary focused signing controls:37 pass. Preliminary full web without PostgreSQL:79 pass,27 environment-dependent skips. Full PostgreSQL/root qualification is separately recorded when completed; skips are not native or database PASS.

## Dependency-aware retirement proposal

The frozen before inventory was independently checked before reduction. See [coverage disposition](QUALIFICATION-DISPOSITION.md) and comparable [before](test-footprint-before.json)/[after](test-footprint-after.json) summaries. Private complete manifests include every path, nonblank-line count, category and SHA256; inline Rust segments retain their original split. Original archived bytes are unchanged.

The current proposal reduces the measured share from70.41% to53.75%. The50% ceiling is NOT passed:5,815 test lines still exceed implementation plus supported operations. No source padding, physical-line compression, moved harnesses or weakened invariant is counted as compliance. Further justified consolidation is still due before M5 completion; this intermediate slice does not waive the budget.

PR82 removed the exactly duplicated foundation operator invocation. This slice retires closed M5 provider-experiment reruns from the default command while retaining the sealed M5-017 in-memory production replay and current diagnostic controls. Historical tests remain available under an explicitly historical manual command, which grants no provider authority. The never-used experimental callback-host pack is removed from current runtime qualification; current HTTP/PG/worker quarantine, owner lifecycle, retention and queue controls remain. Archived M0 workflows follow their own source/evidence inputs rather than unrelated current admin/database/delivery edits. Since this slice changes those workflow files, their natural CI still runs once on this candidate. Current production foundation/database/runtime workflows and Rust/Wasm/stress/renderer qualification remain.

GitHub read-only checks found no main branch protection and an empty repository ruleset list. No protection configuration was changed. Required/naturally applicable checks must still pass on the exact candidate.

## Native outcome

Provider mutations, deployment, signing key creation and merchant fixtures in this slice: NOT_RUN. Existing owner Search success and settled Active1162611916801 are historical native facts, not acceptance of the new build. Protected insignia-rewrite-dev is not an uninstall-test resource. Uninstall/privacy fulfillment and real configure→save→publish→v3 activation are still unfinished. Preserve all legacy apps, closed runs, v1/v2/v3 and whole-quote contracts. Continue within M5 after qualified integration; stop before M6 only at genuine milestone acceptance or a substantive external blocker.

## Completed-change R1 finding and correction

Spec review rejected candidate4aad09d: minimum publishable geometry/method/placement validation occurred after internal preparation. A schema-valid default draft could consume the setup attempt before returning invalid. The PostgreSQL regression reproduced exactly one preparation attempt when zero was required. The correction checks the snapshot before any preparation and retains the transaction recheck. All three publication controls then passed. R1 Standards/security was CLEAR for its original committed head; its verdict is not copied to the changed source. Fresh R2 reviews and exact-head CI are required.

Additional local qualification on the preceding source: full database228 pass/two environment-specific skips; twelve actual selected runtime-workflow SQL profiles passed on fresh isolated PostgreSQL18, including schema-role controls, queue/process crash recovery, authenticated HTTP quarantine, uninstall obligations, admin publication and empty migration rehearsal. The explicit owner-lifecycle profile is a separate remaining check. Publication stress100 cases passed; renderer control is separately recorded. Local Docker image qualification is unavailable and remains natural CI evidence. No native receipt is inferred from these results.

## Final local build/control qualification

The reviewed ordering fix exposed an existing annotation that erased validated geometry into unknown. The helper now returns the runtime-validated geometry type and the snapshot preserves that type; no validation or guard is weakened. A consolidated test import/format omission caused the original runtime CI attempt1 failure; the scoped runtime style check now passes. These failures remain recorded and are not rerun into an old-head green.

Full root qualification after both corrections passed with PostgreSQL18: strict production build, current package/application/adapter/worker/browser controls, boundaries/secrets, Rust fmt/clippy/tests, shared vectors, Wasm replays and historical integrity. PostgreSQL228 controls passed with the two owner controls separately exercised: both owner database controls and both real worker/package controls pass with zero skips. The initial owner test environment had no password and correctly failed the operator endpoint guard; the synthetic environment was corrected, with no source/assertion change. Publication stress100/100 and renderer negative control passed. Twelve selected SQL/runtime profiles passed, including empty rollback rehearsal. See [local checks](local-checks.json).

Fresh read-only production metadata still confirms one exact durable designated tenant, zero stored offline credential rows, successful authenticated/bootstrap-created then reused stages, running exact prior web/worker, and no database/provider writes. This is existing Search/bootstrap evidence only. New native Function/signing/readiness and publication remain unqualified.
