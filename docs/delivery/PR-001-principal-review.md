# Principal review — Insignia PR #1

Date: 24 September 2026. Principal: ChatGPT, Insignia Rewrite Project.

## Verdict

**APPROVED — documentation/configuration bootstrap only.**

Repository: `Optidigi/insignia` (ID `1386102402`).
PR: `https://github.com/Optidigi/insignia/pull/1`.
Base and effective merge base: `38a711ad46aec63b8f410519f30352a88e4113c7`.
Reviewed head: `722afb3990468b7963407f9c6706127974d7a8fd`.

No merge-blocking issue was found in the inspected bootstrap documents, requested agent configuration, scope controls and preflight evidence. The maintainer may merge this exact reviewed change. Keep the reviewed head unchanged until that merge; new changes require refreshed review.

This approval is not M0-001 readiness, a passed development gate, permission to deploy, or delegation of merge authority. M0-001 remains unauthorized. G1–G8 remain NOT_RUN. The principal performed no merge, app deployment or store mutation.

## Review performed and evidence limits

- Read current PR metadata, the complete 40-file change inventory, fixed-ref comparison and merge-base result through the GitHub connection. At the review checkpoint the PR was open and unmerged, three commits ahead of its base.
- Read the published AGENTS, Codex configuration, delivery state, tooling register, preflight reports/probes, review packet, historical handoff and relevant skill content. Compared unchanged supplied records by Git blob identity where available.
- Independently hashed the supplied plan and ledger locally, confirmed their bytes match the v1.1 handoff ZIP, and matched their computed Git blob identities with GitHub metadata at the reviewed head. See `PR-001-verification.json`.
- The published plan blob is `d3d7d9c155cdcdcc3b88aeaaa77eebb10d8a767d`; its SHA-256 is `c0432288deb778c4d717871d6f771f95e401d00b6a3caf1b878155cbf0e5422d`.
- The published ledger blob is `3544e054bb52c11713b2bc1c96cdf6d7a2264936`; its SHA-256 is `0c6c02bab83fb5032548c3d1be1f86ea1492ae3cfd26b6cacc8410f7d08737bb`.
- Local-server executions remain reported evidence. The principal has not rerun them on the server. A Git clone from the review runtime failed on DNS resolution; inspection used the connected GitHub surface instead. The browser smoke is not visual-parity evidence, and no binary screenshot claim is necessary for this approval.
- No application CI or gate pass was established. The absence of CI is disclosed and is not a defect that blocks merging this documentation-only bootstrap.
- The unrestricted local review is advisory. Its read-only instructions do not prove enforcement. The failed restricted session is correctly recorded as failed, even though its conversation process returned zero.

## Native GitHub submission

Both the native APPROVE review submission and a fallback top-level review comment returned HTTP 403, `Resource not accessible by integration`. **Neither was posted.** This is a connector permission failure, distinct from the local agent's successful GitHub authentication and PR publication.

This file and the principal's chat response are the external project verdict. The user or local orchestrator may relay this text as an explicitly attributed principal verdict, not as a fabricated native approval or an independent review by the PR author. Do not weaken protections or borrow an identity to create an approval.

## Remaining readiness work: PF-002

There are three focused outcomes before the first implementation authorization:

1. **Restricted execution and configuration.** Establish a working fresh agent/reviewer path with actual repository and skill reads and demonstrable restrictions. Verify the requested `gpt-6-sol` / `high` at the effective client/session launch, not through model self-description. Private provider-side attestation is not required. Native parallel delegation can remain disabled if the sequential fresh-session path works.
2. **Native Rust build/test readiness.** The generic Wasm smoke passed, but the report explicitly notes missing `cc`. Verify a supported host linker, a disposable `cargo test`, and host build-script/procedural-macro execution. Do not infer these from `rustc --version`, clippy or a direct Wasm compile.
3. **Existing Shopify app identity.** Independently establish the designated app's actual OAuth client ID and distribution, separately from the already reported staging-store identity. A narrowly scoped local configuration import from that existing app is allowed in PF-002. This does not authorize app creation, installation, scope/distribution edits, app dev or deployment. Record an absent installation as such and give the later authorized setup step; do not manufacture an installation just to clear preflight.

PostgreSQL, R2, billing access, native parallel subagents and private wire-model telemetry are not requirements for the minimal DB-free M0-001 lifecycle harness. These conclusions do not remove their relevant later-stage requirements.

## Repository identity and continuity

The approved rewrite is the newly created `Optidigi/insignia`, ID `1386102402`. The former repository is now `Optidigi/insignia-legacy`, ID `1208037734`. Old documentation links in the supplied architecture record were written before the rename. The next operational update must route legacy visual-reference reads to the legacy repository without rewriting the locked architecture or reviving migration work.

After the maintainer merges PR #1, PF-002 should use a fresh branch from the actual remote main commit. The next state update should link this review and PR, distinguish current state from historical snapshots, and list only remaining readiness outcomes. Reuse unaffected passing checks.

## Next authorization

The companion `PF-002-readiness-closure.md` is principal-issued and authorizes only readiness closure and its documentation/configuration evidence. Safe diagnosis can run while the merge is pending, in isolated scratch space without changing the reviewed PR branch. PF-002 repository changes follow the maintainer's merge. M0 work requires a separate principal prompt after review.

## Supporting references

Evidence at reviewed head:
- `https://github.com/Optidigi/insignia/blob/722afb3990468b7963407f9c6706127974d7a8fd/docs/delivery/preflight-report.md`
- `https://github.com/Optidigi/insignia/blob/722afb3990468b7963407f9c6706127974d7a8fd/docs/delivery/evidence/pf001r-probes.md`
- `https://github.com/Optidigi/insignia/blob/722afb3990468b7963407f9c6706127974d7a8fd/docs/delivery/review-packet-PF-001R.md`
- `https://github.com/Optidigi/insignia/blob/722afb3990468b7963407f9c6706127974d7a8fd/.codex/config.toml`

Current official tool guidance checked for the next readiness scope:
- `https://developers.openai.com/codex/sandboxing`
- `https://developers.openai.com/codex/config-basic`
- `https://doc.rust-lang.org/book/ch01-01-installation.html`
- `https://shopify.dev/docs/api/shopify-cli/app/app-config-link`

These references support tool behavior, not a claim that the user's machine is repaired or that a Shopify gate passed.
