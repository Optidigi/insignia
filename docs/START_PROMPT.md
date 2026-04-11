# START_PROMPT.md — Insignia fast start

Use these copy/paste prompts to get a fast, high‑quality start without re‑explaining the entire system.

---

## Primary prompt — Insignia build kickoff (recommended)

```
Follow AGENTS.md strictly.

Goal:
- Build the Insignia Shopify embedded app (MVP: manual per‑color uploads, variant pool pricing, admin dashboard, storefront modal, webhooks).

Non‑negotiables:
- Read docs/AGENT_ENTRY.md first; Tier 1 is source of truth.
- Use /shopify-swarm for planning/execution. If unavailable, do the same steps sequentially.
- Use Shopify Dev MCP for Admin API / Storefront API / webhooks / Polaris details. If MCP isn’t available, cite Tier 1 docs and mark uncertainty explicitly.
- Consult skills only when uncertain or explicitly requested (no mandatory skill loading).

Plan constraints (keep it tight):
- Plan Mode required.
- Limit plan to the first 1–2 milestones (max 8 tasks, each with file paths).
- Ask at most 3 critical questions; otherwise proceed with best‑practice assumptions and list them.

Deliverables in the plan:
- Scoped task list with file paths
- Verification checklist (smallest relevant checks)
- Assumptions / risks
- Open questions (if any)

Execution rules:
- Implement in small chunks, one bounded task at a time.
- Run or propose the smallest verification steps after each chunk.
- Update docs/notes/verification if Tier 1 inconsistencies are found.

If the plan becomes broad, stop and propose a split into 2–3 bounded tasks.
```

---

## Implement a feature (Shopify embedded app)

```
Follow AGENTS.md strictly.

Goal:
- <feature goal>

Scope boundaries:
- Touch: <files/areas>
- Avoid: <files/areas>

Acceptance criteria:
- <bullets>

Relevant docs (Tier 1 first):
- <paths>

Do/Don't list:
- Do: <bullets>
- Don't: <bullets>

Workflow:
- Plan Mode required; include file paths in the plan.
- Use /shopify-swarm if this touches Shopify APIs/webhooks/Polaris/theme; otherwise /swarm.
- If delegation tools are unavailable, do the same steps sequentially.
- Run or propose the smallest relevant verification checks.
- Update docs/plan/handoff if needed.
```

---

## Fix a bug / regression

```
Follow AGENTS.md strictly.

Bug summary:
- <what is broken>

Expected behavior:
- <what should happen>

Scope boundaries:
- Touch: <files/areas>
- Avoid: <files/areas>

Acceptance criteria:
- <bullets>

Relevant docs (Tier 1 first):
- <paths>

Workflow:
- Plan Mode required; include file paths in the plan.
- Use /swarm or /shopify-swarm as appropriate.
- If delegation tools are unavailable, do the same steps sequentially.
- Run or propose the smallest relevant verification checks.
- Update docs/plan/handoff if needed.
```

---

## Verify Tier 1 consistency for feature X

```
Follow AGENTS.md strictly.

Feature to verify:
- <feature name>

Scope boundaries:
- Tier 1 docs only unless a contradiction requires cross‑checking.

Workflow:
- Plan Mode required; include file paths in the plan.
- Use /swarm (scout + verifier) to map: UI/entry → API → schema → webhook → state.
- If delegation tools are unavailable, do the same steps sequentially.
- Update docs/notes/verification/VERIFICATION_REPORT.md with discrepancy IDs.
- Update docs/notes/verification/TRACEABILITY_MATRIX.md if mappings change.
```
