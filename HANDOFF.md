# Insignia — saved planning and delivery handoff

This is the **historical transfer handoff** prepared before PF-001 execution. For current authorization and repository status, read `AGENTS.md`, `docs/delivery/state.md` and the active PF-001R prompt.

Prepared 24 September 2026. Architecture/decision record version **1.1**; operating model version **1.0**.

## Start

At transfer, the local sol-6-high agent was to receive this folder and `docs/delivery/prompts/PF-001-preflight.md`; PF-001 was the only authorized task then. It checked access and instructions and prepared the records for a docs/config-only PR. PF-001R is now the current authorized continuation. Neither prompt starts development gates or builds the application.

## Authoritative paths

- `docs/architecture/implementation-plan.md`: full architecture, contracts, gates and M0–M11 implementation sequence.
- `docs/architecture/decision-ledger.md`: approved business/architecture decisions.
- `docs/delivery/operating-model.md`: principal ownership, local execution, slices/workstreams, review and permission boundaries.
- `AGENTS.md`: concise agent entry point with task-based pointers.
- `docs/delivery/state.md`: current authorization, gate status and handoff index.
- `docs/delivery/tooling-register.md`: what must actually be probed on the user's machine.
- `docs/delivery/agent-roles.md`: local role briefs; runtime configuration is verified in preflight.
- `docs/agents/issue-tracker.md`: GitHub/spec mapping for upstream skills.
- `docs/delivery/templates/`: slice, review and gate-evidence formats; `.github/PULL_REQUEST_TEMPLATE.md` is the PR entry template.

## What is saved versus executed

These are actual saved files, with an additional local Git snapshot/portable Git bundle and SHA-256 transfer manifest. The archive is a handoff, not a deployed app. **At the time this archive was prepared, no GitHub repository had been created or modified, no local-user tooling was configured remotely, and no Shopify gate had run.** Later, the user designated `Optidigi/insignia` and authorized its minimal initial `main` commit. Current progress is in `docs/delivery/state.md`; the original transfer observation is retained as provenance.

The optional Git bundle contains a neutral docs-only snapshot on `handoff/insignia-bootstrap`, with no remote. It is a recoverable save, not history that must be merged into the rewrite. Prefer copying the verified files into a feature branch of an existing approved rewrite repository; do not replace its `.git` directory or force unrelated histories together.

The SHA-256 manifest accompanying the archive verifies **transfer of this initial snapshot**. Verify it before edits. It is not a permanent CI rule that freezes documents against future approved updates. Git commits govern subsequent revisions. A future edit naturally changes its checksum.

## Change from record 1.0

The approved product/architecture decisions are unchanged. Version 1.1 adds the local orchestrator/principal review arrangement, preflight-first execution, pointers to the operating model and SHA-bound PR review requirements. Product audit remains closed. G1–G8 remain NOT_RUN. Legacy migration remains excluded; production infrastructure remains deferred until M11.

## Working loop

Principal seeds a slice → local orchestrator implements/verifies → local pre-review → PR + review packet returned here → principal reviews exact refs → user merges approved change → principal seeds next slice. The project does not depend on a background watcher or chat memory. The user carries each PR URL/head and review response between this Project and the local agent.
