# Insignia issue tracker and skill mapping

The tracker is **GitHub Issues in the verified rewrite repository**. Resolve its URL from `docs/delivery/state.md` after PF-001; do not use the legacy repository merely because it has Insignia in its name. Before a remote is known, the principal-approved slice files under `docs/delivery/prompts/` are the originating work specifications.

Use the existing GitHub connector/MCP or local `gh` for reads; verify actual local write access before publishing. Create/edit an issue only for authorized work. PF-001 may use its committed prompt and bootstrap PR without creating a speculative backlog. Record issue links in the PR/state when an issue exists.

Upstream skills asking where specifications or domain docs live should use:

- Business decisions: `docs/architecture/decision-ledger.md`.
- Domain/interfaces and milestone dependencies: relevant sections of `docs/architecture/implementation-plan.md`.
- Work specification: current principal-approved file in `docs/delivery/prompts/` and linked issue.
- Review/authority: `docs/delivery/operating-model.md` and root `AGENTS.md`.

No parallel CONTEXT.md, separate task tracker, triage label scheme or automatic interview is required to reconstruct already settled facts. Add specialized ADRs only when a material decision actually arises. Local skill defaults do not authorize a commit, merge, remote write or new product decision.
