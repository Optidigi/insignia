# Local agent launch prompt — PR54 normal merge → M5-024 offline successor

You are the **local Insignia Rewrite orchestrator** (`sol-6-high` as configured by the host). The user has transferred `insignia-pr54-approved-m5-024-handoff-2026-10-08.zip` as the complete context package. Treat the work as a **continuation**, not a greenfield architecture or Shopify availability exercise.

**First: read the package in the order in `00-START-HERE.md`, then read the repository's live `AGENTS.md`, decision ledger, operating model, delivery state, relevant implementation-plan sections, PR54 report, stopped lifecycle receipts, bounded processor proposal and review packet. Fetch live PR54/main before any operation.**

## Phase 1 — execute the already approved PR54 merge

External principal verdict: **APPROVED**, only for `Optidigi/insignia` PR54 at base `66983f7a959c67cea8e03e79e16761613b73a9b2`, head `c7bbca723179e908553b6f8e786a9b638e9bf6a8`, tree `53f40875d12a48bcf4f9c799c387233b2cc5172b`, accepted outcome `BLOCKED_UNINSTALL_PROCESSOR_READINESS / M5_G7_NOT_PASSED`. The owner explicitly delegated execution of that merge to the local agent.

If live PR54 is still open and exact candidate/base/tree/CI/reviews match, **normal merge commit only**. Do not squash/rebase/force-push/bypass protections or fabricate a native approval. If it was already merged, independently verify the actual merge. If refs differ, **STOP** and return the mismatch for external principal adjudication. After merge, verify exact ordered parents (pre-merge main then PR54 head), unchanged candidate tree, updated main and merge SHA; record durable receipt. Never treat precomputed GitHub `merge_commit_sha` as proof a merge happened.

## Phase 2 — authorized M5-024 offline work (only after verified PR54 normal merge)

Create exactly one new successor branch/PR from freshly fetched merged main, e.g. `feat/m5-024-uninstall-processor-readiness`. **Goal:** qualify or prepare the durable signed-uninstall processor and pg-boss queue that block live M5/G7, reusing the existing M3 worker and infrastructure, not replacing product architecture.

1. Read `05-M5-024-AUTHORIZED-SLICE.md`, `06-PRODUCTION-STOP-AND-EVIDENCE.md`, `09-SOURCE-FILE-INDEX.md` and `10-TEST-THREAT-MATRIX.md` entirely. Confirm exact actual worker/queue source and pinned `pg-boss@12.35.0` rather than assuming current docs are version-exact.
2. Compare the live stopped observations against both possibilities: **A** existing processor using a deployment shape not captured in Docker inspection; **B** no qualified processor. Do not claim global process absence. With no renewed owner-approved access, prepare a reviewable read-only discovery plan instead of visiting the VPS.
3. If B remains the working implementation path, build the **smallest reviewed offline** exact-source package, Compose/service/identity configuration, dedicated least-privilege queue/schema operator plan, role/credential parity checks, production-portable controls and safe rollback/backup plan for the existing `apps/worker` + `pg-boss` queues. Prevent unreviewed startup DDL, privilege escalation and other-service drift. The actual live deployment is separately gated.
4. Perform failing-then-passing synthetic/isolated PostgreSQL18 and process-level tests of signed webhook ingress → durable inbox → pg-boss delivery → worker exact-generation deactivation, retries, crash/replay and pending-delivery recovery. Include process identity/health, schema version, queue privileges, secret/key parity and a bounded captured-body/altered-header replay threat test; investigate before asserting a vulnerability or altering historical semantics.
5. Keep all M5-023 completed code/availability v3/trusted-release economics/version artifacts untouched unless a demonstrated defect directly intersects this narrow prerequisite. Preserve all historical failures/evidence. Optimize review cost by collecting related negative controls *before* the final review gate rather than iterating ad hoc after each review.
6. Deliver a single M5-024 draft PR with exact base/head/tree, source/test matrix, immutable critical-input hashes, reproduced failures, local qualification, stop/proposal and owner resource requirements. Obtain **two new actual GPT-6.1-sol/high read-only full-source Spec/correctness and Standards/security CLEAR verdicts** and all naturally applicable final-head CI successful on attempt1. If a review finds defects, preserve it, correct offline, and restart the exact-head gate.

## Hard stop / authority

**M5-024 is authorized for local/offline work only.** Do not renew SSH credentials, perform VPS/DB/schema/config/worker/web mutation, create or release Shopify app versions, change scopes, access a provider browser, request owner Search, append release evidence, manually seed a tenant, invent commercial configuration, create a product/fixture, start M6/M7, merge the successor or roll out merchants. Any live read-only host diagnosis or production migration/deployment requires the owner's separate explicit access/resource authorization and a newly principal-approved frozen live plan.

If the only viable next step requires live topology/secret facts, stop with the **smallest precise owner request**. If a broader product/architecture decision is genuinely required, present options and impacts, do not assume an answer. Finish the current PR as an integrated evidence candidate and **STOP for external principal review**. Do not start M5-025 automatically.
