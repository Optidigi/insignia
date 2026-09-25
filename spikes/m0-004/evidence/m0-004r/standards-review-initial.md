## Standards/correctness

**Medium — the noncanonical-scalar test does not prove strict rejection.** [generate-vectors.py](/home/serveradmin/insignia-m0-004-worktree/spikes/m0-004/fixtures/generate-vectors.py:122) keeps the R half of a valid signature but replaces S with the group order L. A verifier that reduces S modulo L would still reject this mismatched signature, so the test cannot distinguish strict rejection from that weaker behavior. The [evidence claim](/home/serveradmin/insignia-m0-004-worktree/spikes/m0-004/evidence/m0-004r/README.md:24) should be qualified until the test is fixed. Use the valid signature’s **S+L** with its original R, then assert rejection in the pinned Node and Rust paths. A read-only Node 24.21.0 probe accepted the canonical signature and rejected its S+L variant.

## Spec

No additional concrete finding. I reviewed the full specified base-to-HEAD diff, including source, tests, target adapters, runner, evidence, and docs. The original 28 benchmark cases remain in the 42-row matrix; recorded hashes and over-limit flags checked out. Live token transport, Validation amount semantics, policy propagation, stack peak, and numeric query cost remain unverified.

This is neither gate nor PR approval.