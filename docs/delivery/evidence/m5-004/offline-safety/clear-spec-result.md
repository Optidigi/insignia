**Offline safety disposition: three unresolved material findings. This candidate does not receive Spec/correctness clearance for credential access. No principal approval is implied.**

Role: fresh independent, read-only M5-004 Spec/correctness reviewer, session designated `gpt-6.1-sol/high`. No separate provider-private runtime attestation was inspected.

| Binding | Verified value |
|---|---|
| Repository/worktree | `Optidigi/insignia`; `/home/serveradmin/insignia-m5-004-worktree` |
| Base/effective merge base | `a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30` |
| Base tree | `5f3f29d44da7d5f0423fd6902c19dc501f7c79ff` |
| Candidate/HEAD | `e4fce4b6f7ab950e94a639b63785232b9d206032` |
| Candidate tree | `3f8780b70abb33aa4ce7155eb23f6dd108c6d1af` |
| Branch | `feat/m5-004-availability-qualification` |
| Worktree | Clean at final inspection |

**Findings**

1. **P1 — Malformed success envelopes can still clear the unknown-write barrier.**

   At [operator.mjs:554](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:554), ACKNOWLEDGED requires `mutation?.userErrors?.length === 0`, but does not require an array.

   **Condition:** HTTP 200 returns an otherwise valid fixture product with the requested ID/status and `userErrors: ""` or `userErrors: {"length":0}`. The operator marks the write ACKNOWLEDGED. The unchanged production adapter instead rejects this envelope as `provider_shape`, because [availability-hold.ts:474](/home/serveradmin/insignia-m5-004-worktree/packages/shopify/src/availability-hold.ts:474) explicitly requires an array.

   **Consequence:** qualification stops, but [operator.mjs:637](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:637) considers the earlier write settled. If subsequent identity/ownership reads succeed, [qualification.mjs:391](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:391) can send an ARCHIVED cleanup mutation. This violates the malformed-response/unknown-write stop boundary.

   **Smallest correction:** require a valid mutation envelope and an actual empty `userErrors` array before ACKNOWLEDGED. Keep malformed envelopes UNKNOWN. Extend synthetic settlement coverage to malformed success responses and verify that cleanup sends zero further mutations.

2. **P2 — Missing and oversized HTTP 200 bodies still change the actual adapter’s failure semantics.**

   [operator.mjs:275](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:275) rejects a missing body; [operator.mjs:284](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:284) rejects a body exceeding 128 KiB. Both become `Stop('unknown_http_result')` through [operator.mjs:531](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/operator.mjs:531).

   **Condition:** an availability read or mutation receives HTTP 200 with no body, or a body exceeding the adapter’s bound. The direct unchanged adapter reports `provider_shape` at [availability-hold.ts:384](/home/serveradmin/insignia-m5-004-worktree/packages/shopify/src/availability-hold.ts:384) and [availability-hold.ts:394](/home/serveradmin/insignia-m5-004-worktree/packages/shopify/src/availability-hold.ts:394). Through the operator, the thrown transport error becomes `network_or_timeout`.

   **Consequence:** qualification measures altered normalization and, for mutations, may enter the adapter’s ambiguity-recovery read path. The retained event lacks sufficient body-failure information for equivalent replay.

   **Smallest correction:** preserve bounded missing/oversized-body semantics for the unchanged adapter, separately retaining conservative UNKNOWN mutation settlement and a sanitized body-failure observation. Add direct-versus-wrapped-versus-replayed synthetic controls.

3. **P2 — Failed drift and catalog checks do not retain complete normalized case evidence.**

   At [qualification.mjs:330](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:330), the drift acquisition is checked before being recorded. Observation/restoration results are likewise checked before the drift case is appended at [qualification.mjs:343](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:343).

   **Condition:** drift acquisition, conflict classification, mutation count or final ARCHIVED preservation differs from expectations. The report retains a generic stop reason, but loses the actual normalized drift results and failed case entry.

   The catalog path has the same ordering problem: UNLISTED is marked PASS at [qualification.mjs:302](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:302), before catalog qualification; `detail` and `list` are saved only after their assertions at [qualification.mjs:317](/home/serveradmin/insignia-m5-004-worktree/scripts/m5-004/qualification.mjs:317).

   **Consequence:** a catalog mismatch can leave UNLISTED marked PASS without the failed normalized catalog projection. Raw register responses remain useful, but do not preserve the actual returned normalized outcomes required by the brief.

   **Smallest correction:** create each case before execution and persist returned results/counts before checking expectations. Record catalog sub-results separately, and mark the affected case STOPPED on failure. Add synthetic failure controls exercising the actual adapters.

These findings are source-derived; no reproducer was executed.

**Trace of the initial findings**

| Initial finding | Corrected-source disposition |
|---|---|
| Per-directory accounting/serialization | Canonical live directory, initialization sentinel and private-directory checks are present. Counters survive reopening. |
| Incomplete CI/unbound reviews | Gate requires all ten named workflows, exact-head receipts and source/build-bound independent review artifacts/settings. |
| Foreign checkout/stale register binding | Live entry uses the executing module root; complete register-binding equality precedes credential loading. |
| Late continuation releasing the lock | Pending and queued dispatches prevent `close()` from releasing the lock. Already-aborted queued requests reject before dispatch. |
| Malformed rejection classified as settled | REJECTED validation is corrected; the ACKNOWLEDGED branch remains incomplete in finding 1. |
| Wrapper changed HTTP classifications | Non-200 and malformed-JSON handling is corrected; body failures remain in finding 2. |
| Unreplayable sanitized errors | Field presence, classifier codes and adapter-required error types are preserved for the inspected JSON cases. |
| Unrelated metadata drift | Exact acknowledged handle/title/tags/creation timestamp are bound and checked on owned reads and reopening. |
| Incorrect request enumeration | Report now states 59 normal reads; successful workflow totals are 62 including final reads. |

**Other source-traced safeguards**

The serial workflow invokes the actual built availability/catalog adapters. DRAFT performs no adapter status write; ACTIVE, UNLISTED and ARCHIVED retain exact restoration/readback requirements. Hold reload uses a fresh subprocess and checks byte equality before parent-process observation/restoration.

Exact request documents, endpoint/version, variables and fixture ID restrict writes to one DRAFT create and status-only updates. No allowlisted publication, policy, Function, inventory, price, billing, deletion or commerce mutation was found.

Reservations precede actual fetch. Normal caps preserve 12 reads and three updates for finalization. RESERVED/UNKNOWN writes block later status writes and cleanup. Unknown creation permits one exact-marker lookup without granting ownership or mutation settlement. Restoration permission remains experiment-local.

The explicit synthetic workflow seam requires supplied synthetic credentials and transport. Its fake gate is not actual launch clearance.

**Source/evidence inventory and execution**

Read the full M5-004 authority and report; all five operator/source/test files; changed root/CI/delivery documents and evidence; both full initial safety reports/settings and corrective logs; and the complete supplied principal diagnostic package. Read complete production availability/catalog source and tests, availability contracts, catalog deadline transport, and relevant built JavaScript. Also read AGENTS, ledger, operating model, state, code-review and TDD/tests/mocking guidance, M5-003/R/R2 reports, M1 unresolved acceptance, relevant plan sections, tooling register and review-packet template.

Executed only read-only file/Git/hash inspection:

- Fixed refs, trees, merge base and PR29 ordered parents verified.
- Production packages/application sources unchanged from the base.
- Principal manifest: **14/14 entries match**.
- Historical availability/publication/production-activation snapshots match current source bytes.
- At final inspection, `frozen-binding.json` names this exact candidate; **all 173 listed hashes match**. File SHA-256: `e6a0752623e746517f421f273172173d0b4ade5bbf3144bc904c5d1c33fabaf3`.
- `git diff --check`: **exit 2**, for whitespace in retained evidence/review artifacts; not a behavioral finding.
- Supplied 23-test success and historical CI logs were inspected, **not independently rerun**.

No edits, builds, write-requiring tests, delegation, networking, credential access—including metadata—Shopify/provider/browser operations or database access occurred. Current root-suite and exact-head CI clearance were not independently verified.

Live qualification remains NOT_RUN for this review. Even a corrected successful experiment cannot establish previously published availability withdrawal, nonempty publication-history preservation, all-channel propagation, in-flight checkout drainage, atomic product-version CAS, genuine RELEASE_BOUND/recovery provenance, ProductConfig activation or complete M5/G6/G7 acceptance. Nine grants and shared resources were untouched by this reviewer.