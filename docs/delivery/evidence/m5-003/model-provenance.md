# Actual execution model and isolation

The integrator's trusted T3 runtime declares `gpt-6.1-sol` with `high` reasoning. Its selected same-launch settings are in orchestrator-runtime.json. Both restricted CLI writers used explicit `--model gpt-6.1-sol -c model_reasoning_effort="high" --sandbox workspace-write -c approval_policy="never"` in separate assigned worktrees; selected observed turn contexts are in writer-a/b-runtime.json. Network was disabled in each writer sandbox.

Their Git metadata lay outside writable roots, so they created isolated local bundles under `/tmp`; the integrator copied only assigned source/test/migration files, then resolved public-export/manifest/compile and real-PG integration issues. No policy was relaxed. Worktrees/instructions do not themselves isolate readable credentials; no credential-file reads were authorized or performed. The writers performed no provider operation.

Writer A's first PG execution lacked DATABASE_URL and skipped its 21 new tests; these are not claimed as passing writer evidence. Integration subsequently executed all21 against PostgreSQL18.6. The integrated database suite executes73 tests. Writer B's focused suite passed109 synthetic hold tests; integrated Shopify executes202. Writer root secret/boundary prerequisites were incomplete; the integrator executes the complete built root suite and actual opacity probes.

Fresh independent full-source read-only Spec/correctness and Standards/security reviewers use the same explicit model/effort with `--sandbox read-only`. Their exact candidate/dispositions and selected launch contexts are recorded after completion. No full session/token export or provider-private attestation is required or supplied.
