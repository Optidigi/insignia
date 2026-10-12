# Insignia — M5 engineering shape acceptance and M6 authorization

Principal decision: 12 October 2026.
Repository: `Optidigi/insignia`.

## Decision

**M5_ENGINEERING_SHAPE_ACCEPTED / NATIVE_ACCEPTANCE_DEFERRED.**

Accept the integrated M5 engineering shape as a basis for independent M6 development. This is not a declaration that the owner’s native authentication problem is fixed, that the real merchant publication flow has passed, that G7 is complete, or that unattended uninstall/full privacy handling or merchant rollout is approved.

**M6_ENGINEERING_AUTHORIZED.** The local agent may begin the planned secure-artwork vertical slice. There is no additional principal gate for its individual slices or PRs. M7 remains outside this authorization until the M6 engineering milestone review.

This applies the owner’s existing simple-delivery policy; it creates no replacement process, external credential, storage allocation or deployment permission.

## Exact reviewed integration

- M5 cumulative entry recorded by the engineering packet: `f8fff36fca749c6b2b6666550e48c7e347b6d65f`.
- PR97 base: `8775caa3ba878109807e0ca3a7cf175d7246a102`.
- Final PR97 head: `4cf58392b353f540fe7d99aefc7565fb1a62f50e`.
- Verified normal merge and observed main: `36945927e3fedc72c44247ec8357eb669186c0c6`.
- Integrated tree: `5d4008f74173e0792c7925507aba593f91b851fd`.
- Ordered merge parents: the base and final PR head above.
- All seven final-head GitHub Actions workflows returned completed/success when checked.

The decision binds this integrated engineering candidate. Resume from legitimate newer work if the repository has advanced, identifying relevant changes rather than resetting the repository to this snapshot.

## Assessment and evidence limits

The delivered shape retains the existing admin/configuration, renderer, draft CAS, immutable revision, publication and activation boundaries. The current merchant publication source checks draft version, tenant/install scope and eligibility, records the immutable requested revision and outbox, and distinguishes requested from effective publication. The session recovery change reuses the authenticated client transport and restores saved server state; it does not dispatch Save or Publish or restore denied unsaved edits. This is a useful recovery feature, not proof of the native authentication cause.

The consolidated operating model distinguishes engineering readiness, native acceptance and rollout. It removes the old test-line ceiling, first-attempt-only CI rule and universal review restart requirement while retaining meaningful TDD, impact-based independent review and required checks. The inspected adoption/history correction preserves the original records at their historical refs rather than replacing their original evidence.

The packet records 146/146 web/browser/HTTP/PostgreSQL controls, 371/371 Shopify controls, 209/209 application controls and 9/9 visualizer controls, together with impact and cumulative architecture reviews. Review scopes, reused evidence, original failures and the reviewers’ instructional rather than enforced isolation are disclosed. The principal inspected these records and relevant source; private test executions and reviewer sessions were not independently replayed. The deployment is reported and described in PR97; the principal did not access the host or owner browser to independently certify it.

No additional source correction was identified as necessary for the limited engineering progression authorized here. This is not an exhaustive defect-free or production-readiness certification.

## M5 work that remains open

| Carry-forward item | Meaning and boundary |
| --- | --- |
| Native authentication issue | The owner observed denial while editing. Cause and native resolution remain unconfirmed. Retry session is recovery, not root-cause closure. Keep the issue open and investigate when useful evidence is available. |
| Owner-supervised merchant/G7 acceptance | Configure/preview/save, stale conflict/recovery, publish/pending/effective reopen and assigned browser/session/staff rows still need their applicable native evidence. Missing browser access does not halt independent engineering. |
| Lifecycle and privacy | Generic uninstall quarantine mitigates unsafe generation selection; it does not complete legitimate unattended uninstall or full privacy fulfillment. The bounded owner-mediated path is not a substitute for public-app lifecycle acceptance. |
| Verifier supportability | The deployed workspace/socket verifier and its existing finite freshness rules remain actual dependencies until deliberately changed. Do not disconnect, silently reconfigure or portray them as durable merchant operations merely because engineering progression is accepted. |
| Existing resources and data | Fixture/configuration, private capture retention, journals, verifier services and delayed lifecycle obligations remain owned. Deferral does not suspend actual deadlines or authorize abandonment. |

Keep these in one current acceptance/obligation register. Do not create duplicate STOP-only PRs or request repeated owner browser attempts merely to restate the same missing observation. Relevant real application defects remain defects, separate from unavailable tooling.

The existing designated fixture is product `10519322493211`, ProductConfig `4dbbe8f6-8162-4271-9819-fd485f7d65f6`. Revalidate actual state before permitted native work and reuse it rather than creating replacements. `insignia-rewrite-dev` remains protected from uninstall. No new native action or cleanup was performed by this principal review.

## M6 — the authorized outcome

Deliver the existing plan’s **secure artwork vertical slice**: buyer/merchant artwork can be uploaded into quarantine, inspected in isolation, promoted as a verified immutable asset, previewed safely through the existing visualizer, and downloaded byte-for-byte by an authorized merchant.

Scope is the planned private R2 adapter, upload/session boundaries, isolated inspection and derivative processing, artwork UI, ownership and retention integration. Reuse current domain/application/database/worker/visualizer boundaries. Use the established stack and product contracts. Do not replace M6 with a broad authentication, release-operator, storefront-checkout or billing redesign.

The core acceptance conditions remain:

- Unverified or rejected content is not eligible for quote use.
- Accepted SVG/PNG/JPEG originals remain byte-identical; safe derivatives do not overwrite originals, and arbitrary SVG does not execute inline.
- Inspection results bind to the actual bytes ultimately promoted; overwrites or races cannot substitute uninspected content.
- Tenant/asset ownership, authorized downloads, expiring access, resource limits and retry/orphan cleanup preserve the existing contracts.
- Artwork state and safe preview integrate coherently with the M5 editor/visualizer; retention and actual data handling are accounted for.

These are observable results, not a prescribed task order or implementation recipe. The local agent owns implementation design, test seams, refactoring, tools, model/effort choices within account limits, delegation, independent impact review and normal PR merges. Use meaningful TDD to deliver behavior with useful regression coverage. Use relevant Matt Pocock skills and independent research where they help; prior research is evidence, not an exclusive source of truth.

Local and isolated work may begin immediately. Use externally allocated storage, accounts and data only where the owner’s existing grants actually cover those effects. M5-specific host permission is not automatically permission for a new R2 account/bucket or production artwork processing. Missing external resources warrant one concrete owner request while independent development continues; test doubles or local storage do not establish native R2 behavior.

A supported authorized autonomous browser route may be used. Otherwise defer the precise owner-browser observation and continue the independent pipeline and local UI work. Keep native identity/publication-dependent integration unaccepted until supported by real evidence; never relax authentication to make artwork work.

At M6 engineering readiness, return the integrated source/tree, working artwork flow, relevant tests and review, architecture/contract changes, open defects, separately deferred native checks, and actual cleanup/retention obligations. The next routine principal review is that milestone review, not the next PR.

## Local-agent continuation

Resume Insignia under the current `AGENTS.md`, complete implementation plan, decision ledger and `docs/delivery/operating-model.md`. Record this principal verdict and make M6 the active engineering milestone, with the named M5 native-acceptance and operational obligations still open. PR97 is already merged; verify rather than repeating it. Continue useful M6 implementation under delegated local review/merge authority. No separate planning-only approval cycle is required. Do not restart watching, prior Console/setup commands or native acceptance attempts simply because this review has completed. Progression authorizes engineering; existing resource grants and actual safety constraints govern any external action.

## Evidence references

Repository-relative paths at the reviewed merge unless stated otherwise:

- `docs/delivery/evidence/m5-simple-delivery/ENGINEERING-REVIEW.md`
- `docs/delivery/evidence/m5-simple-delivery/qualification.json`
- `docs/delivery/evidence/m5-simple-delivery/review-impact.md`
- `docs/delivery/evidence/m5-simple-delivery/review-cumulative.md`
- `docs/delivery/operating-model.md`
- `docs/architecture/implementation-plan.md` — M5, M6 and implementation/acceptance sections.
- `apps/web/src/islands/MerchantConfigEditor.tsx`
- `apps/web/src/shared/admin-request.ts`
- `apps/web/src/server/merchant-config.ts`
- PR97 code/test/adoption patches and live PR/merge metadata.
- Final-candidate workflow IDs: `38286150540`, `38286150492`, `38286150213`, `38286150316`, `38286150493`, `38286150208`, `38286150359`.

This is the principal’s project-level engineering verdict and M6 development authorization. It is not a GitHub-native approval, a merge action, a deployment action or full M5/G7/native/rollout acceptance.
