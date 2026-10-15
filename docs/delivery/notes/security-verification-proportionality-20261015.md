# Security and verification proportionality — 15 October 2026

Research baseline: main `b1dfda98ca6631e2e426ce7d18e6bf5d00f24f80`. This is a recommendation, not a scope amendment or acceptance verdict. Implementation/integration paused for this audit. Only research notes were written; no code, CI, protections, permissions, runtime, billing or retention policy changed.

## Finding

**Yes, there is demonstrated excess in verification process. There is no evidence justifying a blanket reduction of the product's core security controls.** Use fewer repeated reviews/checks and improve selection; keep tests that prove different trust boundaries. Broad testing and strong controls also coexist with concrete gaps, so “many tests” does not mean the app is over-secured or fully qualified.

The latest two-file documentation correction ran three complete workflows: 493+168+479 seconds, about19 aggregate runner-minutes and8m18 elapsed. Broad build/style/boundary/secret checks repeat across the three workflows; a full database command repeats twice. This is one real sample, not a cost or guaranteed speed-up estimate. Different database roles/environments, actual worker processes and production Functions supply distinct observations and cannot be collapsed merely because names overlap. [CI audit](verification-ci-overlap-audit-20261015.md).

Two-axis independent review was reasonable for PR159's financial migration, locking, immutable facts and tenant scope. Narrow correction review was sufficient for its count/ACL test fix. The small PR160 pointer updates received narrow independent checks in the delivery thread; repeating app-wide reviews or behavioral tests for each pointer adds little useful assurance. I used more review/CI ceremony around those documentation updates than their risk warranted. Current policy already permits a simpler approach. [Review/skills audit](verification-review-skills-audit-20261015.md).

## What security standard actually applies

The active AGENTS, operating model, authority and architecture documents inspected do **not** name an adopted ASVS assurance level, ISO27001/SOC2 certification target or formal certification program. The current baseline is the approved Insignia product/security contract, plus applicable Shopify platform requirements. Absence of a named framework is not evidence of compliance or absence of obligations.

Shopify expects protection against common web vulnerabilities, TLS, appropriately closed service ports and secure token generation, with App Store review and additional best-practice guidance. Protected customer data has its own minimization/access requirements. Development-store access is not public-app launch approval. [Shopify security](https://shopify.dev/docs/apps/build/security), [protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data).

OWASP ASVS5 is a useful reference for selecting applicable controls; its own guidance asks organizations to choose scope/assurance from risk. It does not establish that Insignia must adopt the highest level or claim complete ASVS compliance. Shopify protected-data “levels” are a separate classification and must not be confused with ASVS levels. Recommendation: validate applicable common-web, authentication, upload and authorization controls against OWASP guidance without starting a new certification/checklist project. [ASVS5 scope guidance](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/en/0x03-What-is-the-ASVS.md).

## Current substantive scope and whether to loosen it

These are documented requirements, not a claim that every one has passed native acceptance. Sources: [decision ledger](../../architecture/decision-ledger.md) LOCKED; [plan](../../architecture/implementation-plan.md) §§1.3,6,7,10,12,14,16; [operating model](../operating-model.md) §§2–7.

| Area | Purpose / current scope | Assessment |
| --- | --- | --- |
| Merchant, tenant and buyer authority | Validated Shopify identity, per-action permission, tenant/installation fences, signed proxy context plus resource capability, private artwork retrieval | Keep. A signed proxy or login alone does not authorize another person's file. |
| Accepted prices and checkout | Exact money, complete signed quote/member set, expiry/key/installation checks, independent Function enforcement and order matching | Keep. Removing these can create wrong-price or falsely attributed purchases. Protocol/product locks cannot be loosened as a test optimization. |
| Billing and durable facts | First-paid event time, immutable purchase/payment facts, once-per-order qualification, permanent trial waiver, truthful unresolved delivery/history states | Keep. Local ledger dedup does not prove provider dedup; runtime dispatch remains unqualified/inactive. |
| Uploaded artwork | Restricted SVG/PNG/JPEG, exact inspected bytes promoted immutably, private originals, safe derivatives, bounded decoder process with restricted network/filesystem and resources | Keep isolation and provenance. Numeric file/pixel/memory/time budgets may be tuned using valid representative and hostile inputs. Dropping SVG would change a useful product commitment; no such change is justified by this audit. |
| Data/operations | Scoped credentials/roles, no secret logging, bounded retention and transitive erasure, restart/retry reconciliation, no blind retry of unresolved external writes, protect other hosted apps | Keep. Actual cleanup and rotation deserve more priority than extra receipts. Source-only secret scanning does not cover all evidence/private copies. |
| Release trust | Independently bound artifact/release/installation facts; true credential expiry; bounded freshness and supportable runtime composition | Keep independent authority. Freshness windows, polling and mechanism details are engineering choices already revisable under operating-model§6. Do not extend real expiry or restamp evidence. |
| Accepted platform residual risk | Approved OptionA accepts unexpected complete policy-evidence loss/rollback outside the supported publication contract as an incident | Preserve this explicit limit. Do not expand engineering into proving impossible universal Shopify consistency or silently remove the accepted boundary. Application-controlled unsafe publication remains a defect. |
| Tests/reviews | Behavior-focused TDD, real PG/role/process/protocol tests where necessary, proportionate independent review, native evidence for native claims, full supported-scope release gates | Keep the outcomes; reduce repeated execution and review rituals. No count/LOC/coverage quota is the target. |

The image parser processes hostile bytes on a host shared with other apps. Resource limits and isolation address a direct threat; OWASP's upload guidance recommends restricted formats, bounded processing and sandboxing. Safe preview re-encoding does not make the decoder or preserved original automatically safe. No justification was found for deleting this boundary. [OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

A reasonable scope excludes newly invented bank/high-assurance certification, custom security infrastructure with no demonstrated need, repeated proof of unchanged hashes after harmless prose, public malware-analysis submission of merchant artwork, and tests that merely reproduce private implementation structure. None is needed to deliver the approved product. This audit does not establish that all of those extras are currently implemented or mandated.

## Skills, agents and proportionate verification

Current operating-model§§2–4 already overrides literal global skill rituals. Project skills are adapted, while some global copies still prescribe mandatory parallel reviews, fixed hypothesis counts or owner-confirmed test seams. Use skills as techniques; retain the public-behavior RED/GREEN intent, not artificial RED for prose or permission loops. SQL guard/role tests are appropriate boundary tests, not automatically prohibited implementation-detail tests.

| Change | Appropriate effort under existing policy |
| --- | --- |
| Plain prose/status/link update | Author checks refs, chronology, links and sensitive-data exposure; no new behavioral tests or automatic delegated review. Authority/security wording warrants one focused independent check. |
| Ordinary behavior change | Meaningful failing example, affected regression and one focused independent review. |
| New money/auth/privacy/concurrency/release boundary | Independent coverage of correctness and security. Two contexts when complexity or different expertise warrants it; no automatic two full app reviews for every edit. |
| Correction to reviewed source | Review the changed assumption/delta, recheck affected behavior and retain prior attribution/hashes. Expand only when the correction changes material risk. |
| Integration/release boundary | Full relevant candidate checks and required native qualification for the claimed supported scope; preserve explicit deferred results. |

Returning reviewers may perform honest impact review; self-checks must not be called independent. More agents or CLEAR verdicts do not replace execution: PR157's reviews missed an actual PG23514 setup constraint. No evidence supports exact token/model-cost savings or a claim that any particular free model is equivalent. Use one bounded research/review agent for a distinct uncertainty; no recursive review-of-review chain. Three bounded researchers were used for this broad owner-requested audit (CI, skills/reviews, baseline cleanup); they wrote only their assigned notes and did not authorize policy or native effects.

## Where verification is currently too weak or uneven

1. **Selection holes:** isolated m4-003, m5-017 and m5-003 script changes can miss their owning workflow triggers. Fixing selection is more valuable than removing useful tests.
2. **Repository enforcement:** read-only API snapshot returned404 “Branch not protected” for classic main protection; repository rulesets returned200 `[]`; effective `/rules/branches/main` returned200 `[]`. GitHub documents the last endpoint as returning active rules including organization rules. No active checks/review rule was exposed by these queries. Agent policy/manual exact-head checks are still binding, but are not an enforced repository gate. Recommend a small deliberate required-check rule aligned with the chosen CI strategy; do not add mandatory two-human approvals or an enterprise governance layer. No settings changed. [GitHub rules API](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch).
3. **Real obligations:** physical object/private-copy deletion, credential rotation and remaining native/recovery gates are not satisfied by green synthetic checks, source scans or extra evidence JSON. Failed asset cleanup is due16October00:31:47.899Z; private backup/probe/archive copies20October; originals retain exact21/22October deadlines. The research pause does not extend them.
4. **Evidence limits:** no full formal control assessment, penetration test, universal test-duplication proof, mutation-coverage study or live cleanup inspection was performed. No blanket “secure”, “over-tested” or certified claim is justified.

## Broader proposals researched: smallest useful decisions

[Detailed options and consumers](verification-baseline-options-20261015.md).

- **D1/status and current-index routing:** already integrated by160. No new pointer-only PR needed.
- **D2/progress JSON:** no repository executable consumer/schema validator found; external readers remain unknown. Prefer exact-byte archival plus an explicit versioned pointer, retiring the obsolete principal-bearing template in the same small change. That is a schema transition, not an update of old milestone verdicts. An adjacent warning is the compatibility-preserving fallback; do not invent another maintained progress registry.
- **D3/duplicate reviews:** preserve packaged originals and aliases/manifests. Use packaged provenance for future citations. No deletion, new16-row canonical registry or recurring deduplication project. Identical copies prove neither extra independent reviews nor fabrication.
- **D4/triggers:** add m4-003 andm5-017 to foundation PR/push paths, m5-003 to durable PR/push paths. Preserve commands and failure semantics. This is a bounded coverage correction.
- **D5–7/efficiency:** first expose aggregate stages with names/log groups without executing twice; add a narrow pointer-doc fast route with unknown/authority/executable inputs falling back to full checks; then consolidate repeated static checks. Keep environment-specific PG/role/process/Function tests. Wholesale shared-build infrastructure or affected-test graph machinery is not justified merely to save a24-second build.
- **D8/worklists:** current header is enough. Preserve historical acceptance maps; clarify a misleading old header only when touched for real work.
- **D9/evidence/retention:** counts are not risk metrics. Prefer actual scoped cleanup and safe credential rotation, with compact results in the existing index. The old DB rotation operator pins18 migrations and is not qualified for native34; do not run it blindly. Preserve sanitized failure/audit history while erasing expired personal copies; “archive” is not an exemption from privacy obligations.

A docs fast route must select checks explicitly, preserve visible required contexts and treat unknown changes conservatively. GitHub reports workflow-level path skipping and conditional-job skipping differently; naïve `paths-ignore: docs/**` can leave checks pending and also hide authority/fixture inputs. Design the small classifier/required summary and test its changed-file decisions before enabling it. Do not mark an unexecuted suite as passed. [GitHub required-check semantics](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

## Recommendation before resuming delivery

**Change execution scope, keep product protections.** Batch related documentation/evidence updates with meaningful delivery, apply the existing impact-based review rule, fix the small trigger holes and address actual cleanup/rotation. Introduce a narrowly verified docs route and consolidate duplicated static checks before considering larger CI architecture. Handle the stale progress schema/template together; leave archived duplicate files alone. Assess the small repository enforcement gap with the same proportionate approach.

No material product/security-risk relaxation is recommended now. Tunable budgets/freshness may change when representative tests demonstrate the current setting obstructs legitimate use and a revised bound retains the security outcome. Reducing supported channels/formats/capacity might reduce acceptance work, but changes commitments and needs a concrete product trade-off; this audit provides no evidence requiring it. Keep Shopify-owned payment/fulfillment/inventory responsibilities unchanged.

This report completes the requested research. It does not start any proposed change. Source refs and read-only observations are captured here and in the three linked notes; no extra process service, test harness, PR or certification program was created.

## Implementation after owner acceptance

The owner replied “ok, proceed”. Candidate `chore/proportionate-verification-20261015` keeps product/security contracts unchanged. It archives the old progress JSON/template byte-for-byte (SHA25644a757f10d4ebbf1aae845643397fee1c6aac03d4685e3d7d508d2572aab7d3b / adcf927c9650635af08bf4423bef1c43c9c2a48f087c802f2a50f450bc361241), uses explicit pointer/retired-template schemas, and preserves historical review copies.

[CI classifier](../../../scripts/ci/status-docs.mjs) accepts only modifications to existing Latest integration/Latest main reference lines in the two current documents, with other text and nonidentifier wording unchanged. Real Git objects, regular-file modes, exact line uniqueness, changed links and likely credentials are checked. Unknown/code/authority/workflow/text changes select full checks; malformed candidate documents fail. All three workflows now select every PR; existing push selection is preserved with the known script gaps repaired. Each job reports its selected route; the fast route produces no build/image/Wasm artifacts and is not native qualification. PostgreSQL services still start in the fast route; broader suite splitting/static-check consolidation is deliberately deferred until actual route results, without new build-sharing infrastructure.

TDD: minimal full-only stub failed six relevant cases; implementation now passes all10 real-Git/CLI/workflow tests. Root independently ran10PASS, changed-file Biome, YAML/inherited-step/environment preservation checks, JSON target/archive equality and diff checks. No artificial prose RED or duplicate application test run. One independent combined correctness/security review (preview_verifier_transition) CLEAR on frozen helper4b402bd1b6bbe8e130dfaaac31c9cd7398da30e792e27e134829ffa1b107a659 / test558e2d5fe57e1b435e1e0b031678198cf23ea08e5282b616bba0f8ca7c2cbcd5 and all three workflow hashes. The reviewer confirmed existing artifact/head/tree/digest and separate source/container authority checks prevent green status-only jobs from becoming deployment evidence.

[Prepared main protection](../../../deployment/repository/README.md) requires the existing three GitHub Actions app15368 checks, applies to administrators, prevents force pushes/deletion, and introduces no human-approval checkpoint. Live API confirmed existing administration access and app identity. It remains unapplied until final-candidate full CI and normal integration; recheck live settings before writing and verify readback afterward. Missing GitHub plan/capability must be reported, not bypassed. Actual hosted fast-path results and protection readback are still pending; no savings beyond the audit sample are claimed yet.

Scoped retention metadata was rechecked on the exact recorded database15October13:51:47Z: b92a remains UPLOADING, no cleanup attempt/ACK, due16October00:31:47.899Z. No mutation, deletion or retry. Other retention/rotation obligations remain open in the existing work index; no private payload was added to these notes.
