# Insignia Rewrite — PR54 approved → M5-024 continuation handoff

**Created:** 8 October 2026. **Repository:** `Optidigi/insignia`.  **Purpose:** transfer exact project, principal verdict, stopped-production evidence, safe merge instruction and a narrowly authorized successor to the local orchestrator. This is a *continuation*, not an architecture redesign.

## Read in order

1. `00-START-HERE.md` — this entry and precedence.
2. `01-LIVE-CHECKPOINT.md` — observed state and exact hashes.
3. `02-FULL-PROJECT-BRIEF.md` — product/technical foundation, revised for latest outcome.
4. `07-LOCKED-DECISIONS.md` and `08-GOVERNANCE-MERGE-AUTHORITY.md`.
5. `03-PR54-PRINCIPAL-VERDICT.md` — **APPROVED** stopped M5-023 candidate.
6. `04-AGENT-LAUNCH-PROMPT.md` — complete executable directive for the local agent.
7. `05-M5-024-AUTHORIZED-SLICE.md` — only new successor authority: **offline** worker/queue prerequisite qualification and implementation.
8. `06-PRODUCTION-STOP-AND-EVIDENCE.md` plus `receipts/`.
9. `09-SOURCE-FILE-INDEX.md`, `10-TEST-THREAT-MATRIX.md`, `11-LIVE-EXECUTION-BOUNDARIES.md`.
10. `13-HISTORY-AND-GATES.md`, `12-AUDIT-FOLLOWUPS.md`, `14-EXTERNAL-RESEARCH-NOTES.md`, `manifest/`.

Then read **live repository** `AGENTS.md`, `docs/architecture/decision-ledger.md`, `docs/delivery/state.md`, `docs/delivery/operating-model.md`, the approved slice prompt, pertinent `implementation-plan.md` sections and latest PR/evidence. The live decision ledger and approved user decisions override this cached package. Historical archives under `historical/` are for reference only and must not reset today's refs.

## First operation (before any merge/edit)

Fetch **live** `Optidigi/insignia` PR #54, `main`, effective merge-base, review packet and CI. This package observed:

- `main`/PR53 normal merge: `66983f7a959c67cea8e03e79e16761613b73a9b2`.
- PR54: **open, ready (not draft), unmerged**, source branch `feat/m5-023-managed-install-bootstrap`.
- PR54 approved head: `c7bbca723179e908553b6f8e786a9b638e9bf6a8`.
- PR54 exact tree: `53f40875d12a48bcf4f9c799c387233b2cc5172b`.
- Final-head natural CI: **11 successful attempt-1 workflows**; final Spec/correctness and Standards/security reviews report **CLEAR/CLEAR** in the PR54 qualification comment.

If refs or approvals have legitimately changed, do not reset branches or merge an unreviewed candidate. Stop for renewed principal adjudication. If PR54 is already merged, verify its **normal** merge receipt instead of trying to merge again.

## Authorized continuation

**Step 1:** Under the owner's express delegation to the local agent in this conversation, normally merge **only** the exact principal-approved PR54 head. Verify merge ordered parents and tree, record actual merge SHA, and do not use squash/rebase/admin-bypass.

**Step 2:** Only after that verified merge, start **M5-024 — existing uninstall processor and durable pg-boss queue prerequisite**, with **offline-only implementation and qualification** described in `05-M5-024-AUTHORIZED-SLICE.md`. One successor branch/PR; return it for principal review.

**Step 3:** Stop before renewed production access/credential use, host/database/queue mutations, deployment, owner Search, Shopify provider operations or fixture. Such actions require fresh explicit owner resource approval **and** a reviewed frozen live plan. No independent M5-023 continuation is implied by PR54's merge.

The prior outcome is **`BLOCKED_UNINSTALL_PROCESSOR_READINESS`**, not a failed local bootstrap implementation. **`M5_G7_NOT_PASSED`** remains true.
