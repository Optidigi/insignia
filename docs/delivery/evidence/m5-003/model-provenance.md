# Actual execution model and isolation

The integrator's trusted T3 runtime declares `gpt-6.1-sol` with `high` reasoning. Its selected same-launch settings are in orchestrator-runtime.json. Both restricted CLI writers used explicit `--model gpt-6.1-sol -c model_reasoning_effort="high" --sandbox workspace-write -c approval_policy="never"` in separate assigned worktrees; selected observed turn contexts are in writer-a/b-runtime.json. Network was disabled in each writer sandbox.

Their Git metadata lay outside writable roots, so they created isolated local bundles under `/tmp`; the integrator copied only assigned source/test/migration files, then resolved public-export/manifest/compile and real-PG integration issues. No policy was relaxed. Worktrees/instructions do not themselves isolate readable credentials; no credential-file reads were authorized or performed. The writers performed no provider operation.

Writer A's first PG execution lacked DATABASE_URL and skipped its 21 new tests; these are not claimed as passing writer evidence. Integration subsequently executed all21 against PostgreSQL18.6. The initial integrated database suite executed73 tests; the corrected final source now executes89. Writer B's focused suite passed109 synthetic hold tests; integrated Shopify executes202. Writer root secret/boundary prerequisites were incomplete; the integrator executes the complete built root suite and actual opacity probes.

Fresh independent full-source read-only Spec/correctness and Standards/security reviewers use the same explicit model/effort with `--sandbox read-only`. Their exact candidate/dispositions and selected launch contexts are recorded after completion. No full session/token export or provider-private attestation is required or supplied.


A later restricted admission writer used the same actual model/high settings in a separate worktree while the integrator owned non-overlapping recovery/readiness paths. Its selected context is `admission-writer-runtime.json`. At no time did this add a third concurrent writer. Its isolated shared-dependency shim did not constitute full root/PG verification; final integrated commands provide that evidence.

Initial fresh full-source Spec and Standards/security reviews requested changes on `09e301f…`; their complete sanitized findings and selected contexts are retained. Ordinary in-scope corrections were implemented locally. Final independent full-source rereviews use fresh contexts, the same explicit model/high settings, read-only sandbox and no provider operation; exact candidate refs and dispositions belong in the PR body.


The second full-source sessions reviewed `f46535c…`: Spec requested two recovery corrections; Standards/security reported no material finding at that earlier head. Both reports remain attributed local verdicts. Their selected actual contexts independently record `gpt-6.1-sol`, effort `high`, approval `never`, sandbox `read-only`; the Spec report’s statement that its own interface cannot attest private runtime routing is preserved, not rewritten. Observable launch/context evidence satisfies the execution-setting check without claiming provider-private attestation.


Third full-source sessions reviewed `1e2765f…`: Spec thread `01a0f7bb-1202-7b30-94ce-b9eb69408ac1`; Standards/security thread `01a0f7bb-1230-7970-a676-8aa69ffe2de0`. Both used explicit gpt-6.1-sol/high, approval never, read-only sandbox; their selected contexts and findings are preserved. The integrator corrected both findings. Interrupted-session audit found no running M5 writer/reviewer/browser process; the retained project-scoped PostgreSQL server is shared local test infrastructure and was left intact. Fresh full-source reviews of the corrected candidate follow, with exact refs/dispositions in the PR body.
