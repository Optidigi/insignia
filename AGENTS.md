# Insignia — agent entry point

## Start every session

Read `docs/delivery/authority/milestone-autonomy-2026-10-09.md`, `docs/architecture/decision-ledger.md`, `docs/delivery/operating-model.md` and `docs/delivery/state.md`. Read relevant sections of the complete `docs/architecture/implementation-plan.md` and active milestone charter before changing behavior. Fetch current PR/main; resume legitimate newer work rather than a stale handoff SHA.

The owner delegates execution, slice/PR review and normal merges **inside each milestone** to the local orchestrator, effective immediately for unfinished M5. The principal reviews completed milestones, not each slice. Old per-PR stop/merge-prohibition instructions are historical where they conflict with this decision; product, security and resource conditions remain binding.

## Execute the milestone

Own its worklist, implementation, research, tests, tools, subagents, local acceptance, integration and continuation. Use narrow end-to-end slices and maintain the whole milestone acceptance map. Obtain independent fresh read-only Spec/correctness and Standards/security review, resolve findings, qualify exact-head CI, merge normally under delegated authority and continue. Do not invent a principal verdict or waive repository-enforced approvals.

Use pinned Matt Pocock `writing-for-agents` for agent documents, `tdd` for behavior, `diagnosing-bugs` for defects, `code-review` for independent reviews, `handoff` for context transfer and inspected `research` for platform uncertainty. Use other relevant actual tools/skills/subagents as needed, with provenance, least privilege and real runtime checks. The operating model is the single orchestration policy.

## Preserve contracts

The decision ledger controls product/architecture locks. Keep the domain independent of Shopify, frameworks, rendering and persistence; Shopify SDK stays in its adapter and Konva stays a renderer. Preserve exact money, whole-quote v2, tenant/generation fences, immutable historical records, availability v1/v2/v3 meaning and retention. Legacy is only the storefront visual reference; no legacy migration/import work.

Documentation, mock success or CI alone is not native-store evidence. Preserve RED security controls until an implemented correction actually qualifies; passing characterization is not a fix. Do not mark M5 done with G7 or required publication/installation safety still blocked. Do not start M6 before principal acceptance of M5.

## Resources and exceptions

Use owner-allocated resources within their recorded limits after local technical qualification. Missing credential/resource/cost/production/destructive-operation permission requires a concrete owner request, not another principal-review slice. No secret leakage, invented commercial configuration, human-verification bypass, unauthorized Shopify version/scopes, merchant rollout or ambiguous mutation retry. A material locked-decision conflict or incident is a real exception; continue independent safe work.

## Finish

Keep the active delivery state short and the local full plan current. At milestone completion, freeze the integrated commit/tree, run cumulative drift/integration/security review, assemble acceptance/demo/test/native/cleanup evidence, and stop for principal review. Merged slices do not themselves grant milestone acceptance. Runtime interruptions require a resumable handoff, not a fictitious completion claim.
