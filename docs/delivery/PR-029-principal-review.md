# PR #29 — external principal review: CHANGES_REQUESTED

Issued 1 October 2026 by ChatGPT, principal architecture/review role in the Insignia Rewrite Project.

## Exact binding and verdict

| Field | Value |
|---|---|
| Repository | Optidigi/insignia |
| PR | https://github.com/Optidigi/insignia/pull/29 |
| Base / current main | `8a84ddeaf277368852d224915abe6d4a93a3d8a4` |
| Reviewed head | `a426719e5350f61ecb5620f6c90ab7a0e365e66b` |
| Reviewed tree | `6b60ec923a3601584e05c76fcce362a9c0534d88` |
| Branch | `feat/m5-003-activation-admission` |
| Native state inspected | Open, non-draft, unmerged; native reviews empty |

**CHANGES_REQUESTED. Keep the existing PR open.** Correct R1 and R2 under the accompanying M5-003R brief, then return the complete corrected candidate for principal rereview. This is an external project verdict, not a native GitHub review. No merge or Shopify/provider operation is authorized by this verdict.

GitHub's head-filtered workflow query returned ten completed successful PR workflows. The PR comment supplies fresh local Spec and Standards/security clearance. Neither overrides the two findings below. The reported attempt-1 status, PostgreSQL 90/90 and browser stress 100/100 remain attributed local/CI evidence; the principal did not rerun those suites or independently re-fetch every run's attempt metadata.

## Spec / correctness

### R1 — availability observation age is reset after slow reads (P2; required)

Source: [availability-hold.ts, lines 391–409](https://github.com/Optidigi/insignia/blob/a426719e5350f61ecb5620f6c90ab7a0e365e66b/packages/shopify/src/availability-hold.ts#L391-L409), especially the `time()` passed to `parseProduct` after `await execute`. Mutation results are also timestamped at completion at lines 411–433. The publication admission consumer is [production-activation.ts, lines 72–99](https://github.com/Optidigi/insignia/blob/a426719e5350f61ecb5620f6c90ab7a0e365e66b/packages/database/src/repositories/production-activation.ts#L72-L99).

The complete adapter stamps `observedAt` after receiving/parsing the response and after its post-response credential checks. Admission then treats that value as the freshness origin. Transport or credential-check delay disappears from the apparent age. This contradicts the conservative observation-start treatment already used for the remote projection in the same production composition.

An independent offline probe executed the unchanged adapter and the exact admission callback. With a captured DRAFT payload delayed by 2,000 ms under an injected clock, a 1,000 ms admission budget returned `true`: reported age 0 ms, controlled payload age 2,000 ms. The immediate-read control also returned `true`, as expected. The contract assertion fails with exit 1. The two source snapshots were verified against their exact Git blob identities before execution.

This directly demonstrates incorrect freshness admission, not a live checkout bypass. Tracing the consumer shows the consequence: a stale hold read can satisfy the publication admission predicate. The full PostgreSQL publication path must receive the correction regression; it was not executed by this principal probe.

Required result: freshness retains a conservative pre-I/O origin through normalization and every consuming check. Distinguish that origin from receipt/completion time where necessary. Preserve legitimate provider timestamps generated during the request; moving the existing future-version comparison unchanged onto a request-start timestamp is not a correct fix.

### R2 — a valid Shopify product status is rejected as malformed (P2; required)

Source: [availability-hold.ts, lines 179–184](https://github.com/Optidigi/insignia/blob/a426719e5350f61ecb5620f6c90ab7a0e365e66b/packages/shopify/src/availability-hold.ts#L179-L184) and restoration mapping at line 412; [availability.ts](https://github.com/Optidigi/insignia/blob/a426719e5350f61ecb5620f6c90ab7a0e365e66b/packages/application/src/publication/availability.ts); [catalog.ts](https://github.com/Optidigi/insignia/blob/a426719e5350f61ecb5620f6c90ab7a0e365e66b/packages/shopify/src/catalog.ts), its status union, `project`, and list mapping.

The new hold adapter accepts only ACTIVE/DRAFT/ARCHIVED. Its tests explicitly label UNLISTED an unknown status. Shopify's current ProductStatus reference and developer changelog establish UNLISTED in Admin API 2025-10 onward; this adapter targets 2026-07. Unlisted is not equivalent to unavailable or to ordinary discoverable ACTIVE.

The full-adapter offline probe accepts ACTIVE/DRAFT/ARCHIVED, rejects a genuinely unknown control, and rejects otherwise valid UNLISTED with `provider_shape`. A separate status contract assertion fails with exit 1. Source inspection also finds the earlier catalog reader rejects UNLISTED; because list maps every returned product through that validator, an otherwise valid mixed page containing one unlisted product is rejected. The catalog consequence is a static finding, not a principal-executed browser test.

Correct the adapter and its directly interacting catalog/Admin contracts. Preserve the original unlisted status through snapshot, hold, persistence, readback and restoration; do not simply map it to ACTIVE. Keep genuine unknown-status rejection. This is supported-provider-value handling within the existing product workflow, not a new commercial feature or a reason to change the Shopify API version.

## Standards / security

R1 is also a provenance/freshness boundary defect: a late response must not gain newer observation authority merely by arriving late. It is the same finding, not an additional blocker.

R2 demonstrates an incorrect provider-contract assumption embedded in both code and a negative test. Replace that negative fixture with a genuinely unknown value, and test legal status roundtrips through public seams.

No stylistic refactor is requested. Preserve current dependency direction, exact-money/v2 contracts, installation fencing, immutable evidence, one-use restoration claims, independent recovery authority and safe package facades. These findings do not justify reopening the application stack or adopting another pricing mechanism.

## Review scope and evidence limits

The principal read the current entry instructions, ledger, operating model, active brief, M1 carried obligations, relevant plan sections, M5 report and final local review comment; inspected the affected implementation and interacting activation/admission/recovery/Admin contracts; and verified current GitHub main, PR refs, head tree, native review state and head-associated workflow conclusions. Earlier source/review records in this conversation informed the fixed-ref inspection.

Independent execution here used **Node 22.16.0**, not the repository's pinned Node 24. The complete unchanged Shopify hold adapter ran with synthetic HTTP/credentials/clock; the exact admission callback ran with a synthetic store. No PostgreSQL transaction, real merchant operation, full workspace build, full browser suite, full history re-audit or independent principal-side subagent review is claimed. A container clone failed DNS; connector reads and Git-blob-verified source reconstruction supplied the executable source.

The probe is diagnostic evidence, not an evergreen test of a future corrected checkout. Add committed public-seam regressions on the actual implementation under the pinned runtime. This changes-requested review is not blanket clearance of every other PR path.

## Retained obligations

The earlier local R1–R3 failures and their corrections remain history. They must not be overwritten by this review. The final local reviewers' no-finding conclusions remain their correctly attributed conclusions, now followed by these principal findings.

Live all-channel/in-flight admission, non-CAS product-status race qualification, release-bound deployed Function authority, authenticated operator recovery, and remaining live G7 remain open. M5 is not complete; no complete G6/G7 acceptance, M6/M7, release or launch follows from this correction.

## Evidence and external contract references

- `evidence/results.json`: independent fixed-source outputs and source hashes.
- `evidence/probe.mjs`: executable diagnostic; `--assert-freshness` and `--assert-status` are expected red at the reviewed source.
- `evidence/README.md`: scope, commands, source provenance and limitations.
- https://shopify.dev/docs/api/admin-graphql/latest/enums/ProductStatus
- https://shopify.dev/changelog/posts/new-unlisted-product-status
- https://shopify.dev/docs/apps/build/product-merchandising/unlisted-products

The version-specific 2026-07 documentation URLs were not retrievable in this principal web session. The accessible current enum reference, the October 21, 2025 changelog identifying API 2025-10, and the current product-status guide corroborate the known value. Live store behavior and reversible status changes remain separately unqualified.
