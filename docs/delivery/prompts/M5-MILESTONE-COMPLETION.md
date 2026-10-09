# M5 — autonomous completion charter

Authority: `../authority/milestone-autonomy-2026-10-09.md` and `../operating-model.md`. Active until the principal accepts completed M5. This replaces slice-by-slice external engineering approval; it does not grant unallocated live resources.

## Outcome

Deliver the original M5 end shape: merchant product configuration, preview, draft save/conflict handling, immutable publication and the required G7 embedded-admin behavior, with safe install/uninstall/readiness dependencies actually qualified. Preserve the architecture and commercial/security contracts. A locally green test suite or a merged STOP PR is not this outcome.

## Continue, do not rebuild

Fetch and locally adjudicate PR58 and main. Current handoff snapshot: main/base `a87ed85034dcaaf3b4b86bb1f0d9986f6e59d449`, PR58 head `a5383ca7dac1e789d185ca311813fea91c4df872`, tree `b6e7e6d7fc931b84d4a72e09981a95a317024621`. Prefer legitimate newer state. Validate prior local reviews/CI before reuse; accept/merge locally if eligible. Update governance through a locally reviewed PR; no external principal PR gate.

Reuse M5-023 bootstrap, M5-024 queue/worker work and M5-025–027 authority/destination analysis. The known state is `STOP_PRE_INSTALL_DESTINATION_EFFECTS_UNQUALIFIED / M5_G7_NOT_PASSED`; native destinations/processors are unobserved and the generic webhook generation assertion remains RED.

Build a single milestone completion worklist with plan references, current evidence, dependencies and owner inputs. Do not generate new STOP/report-only slices that merely restate the same missing access.

## Critical path

1. Prepare/qualify the bounded read-only collector and native inventory from `M5-027-READ-ONLY-INVENTORY.md` locally. Separate tests that actually run from unanswered native facts. Inventory destinations, automatic auth/bootstrap, mutable reads, unknown-shop ingress, queue/retry revival, privacy processors and delayed obligations.
2. Resolve the missing resource authority with a single specific owner request covering exact identity, access/credentials, allowed read or mutation/effect budget, secrets channel, cost and cleanup. Do not ask the principal to approve another document-only proposal. After owner allocation, the orchestrator locally qualifies and executes within that scope.
3. Decide and qualify generation-safe uninstall authority under the already established invariant. Confidential generation-bound callbacks are a candidate, not an adopted solution. Evaluate lifecycle gaps and independent alternatives using evidence; preserve receipt admission, legitimate uninstall and privacy duties. If a material locked-risk/product/protocol change is genuinely necessary, escalate that precise decision; otherwise implement and review locally.
4. Correct affected admission/worker/bootstrap boundaries with real failing-then-passing HTTP/PostgreSQL/worker controls. A successful registration or old-body hash dedup alone does not solve all gaps. Keep historical failed results intact; add the corrected source/evidence separately.
5. Reuse and qualify exact worker packaging, pg-boss owner/runtime separation, roles, immutable executable/launcher, real image/isolation, health/restart/crash/rollback and current route/secret parity. Docker/template/source checks are not native image proof. Obtain actual owner permission for host resources and operations before deploying; use a new reviewed run, not a reopened sealed M5-023 attempt.
6. Within the owner-approved envelope, provision/deploy only necessary corrected web/schema/worker prerequisites, protect unrelated services, prove authenticated owner Search and current provider-derived shop/install/staff/readiness. Preserve original trusted-release observation deadlines and no-restamp contract. Shopify Active/version/scopes cannot be changed without their separate owner authority.
7. Complete the real M5 configure -> preview -> save -> immutable publication -> FIRST_PUBLICATION v3 -> activation -> cleanup flow and all assigned G7 rows. Legitimate owner-backed commercial configuration or an explicitly approved dev entitlement is required; never invent plan/usage/policy/features/subscription values.
8. Freeze the integrated milestone candidate, run broad regression and two new independent milestone reviews plus cumulative drift audit, and hand completed M5 to the principal. Stop before M6.

## Scope discipline

Necessary supporting safety work in M3/M4 packages is part of completing M5; it does not relabel those historical milestones. Do not drag all M9 commercial implementation or all M10/M11 operations into M5. Complete the prerequisites actually required for safe M5 evidence, record genuine remaining later-milestone obligations, and preserve the original G1–G8 timing from plan §14.2.1.

Keep the merchant editor/refactor and operational improvements bounded to actual needs. No Availability v3 redesign, React substitution, fee products, unsigned economics, legacy import, fake gate PASS or unauthorized rollout. Known incidents or unallocated actions may pause dependent work; they are not a reason to stop all safe M5 progress for routine principal approval.
