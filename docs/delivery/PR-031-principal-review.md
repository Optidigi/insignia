# PR #31 — external principal review

**Verdict: APPROVED for the M5-005 bounded diagnostic implementation and its observed evidence.**

Principal: ChatGPT in the Insignia Rewrite Project. Review date: 2 October 2026.
This is an external project verdict. No native GitHub review, repository write, merge or Shopify operation was performed by the principal.

## Exact binding

| Field | Reviewed value |
|---|---|
| Repository / PR | Optidigi/insignia / #31 |
| Branch | feat/m5-005-scope-provenance |
| Base and effective merge base | 6687e443baf97ee8bf179db61a1e4450f903f8eb |
| Approved head | dc9db629559d5fa7049de2d0d3fed28d53a08fb4 |
| Approved tree | aeb12dba4944b5934fc33c5494992c6ad5ca87dd |
| GitHub state at review | Open, non-draft, unmerged; native review list empty |

The actual PR #30 merge is the base above. Its ordered parents are `a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30` and `30f00935f90f7564d426838487b3a6e5f37a9e01`; its tree is `e772af245c7f09c59d398656e16305adfeaea005`. GitHub commit/ref/compare reads independently confirm those identities and the two-commit PR #31 ancestry.

Keep this approved head unchanged through any owner-authorized normal merge. A changed base/head requires renewed review. Import this verdict into `docs/delivery/PR-031-principal-review.md` on the subsequent evidence branch, not as an additional pre-merge commit on PR #31.

## Spec/correctness

No unresolved material finding in the inspected change. The M5-005 contract permitted an unresolved causal result when the authorized observations could not distinguish causes. That is the correct disposition here, not a failed availability test.

The live entrypoint enforces one existing-route exchange, two fixed GraphQL reads and one same-bearer access-scopes GET. The source gate precedes credential access; identity verification precedes the remaining reads. The diagnostic deliberately does not require scope equality before observing scope differences. This does not change the M5-004 guard or production authorization.

Scope projections distinguish field absence, null, wrong type, malformed handles, duplicates and explicit emptiness. Comparison requires reliable responses. Metadata shape/permission errors remain observations; token-invalid, mismatched identity and unknown pending work stop continuation. The selected-field validator is honestly bounded to its two documents rather than represented as full provider SDL validation.

The retained register records four HTTP 200 responses at **2026-10-02 01:23:18.521–01:23:19.717 UTC**, exact identity and five explicitly EMPTY scope projections: token, installation, REST, requested and optional. It has no remaining programmatic allowance and no pending work. Both Dashboard inspections were NOT_OBSERVED because the local automation host was unavailable. The frozen live source is `6cde4be314904e0c82152d378fb9bf7864ba1fa1`, tree `5e31daec61ced395dc623a401031274fc0214403`; the approved evidence head is distinct.

## Standards/security

No unresolved material finding in the inspected change. Fixed routes/documents, one-use durable reservations, finite preparation/body deadlines, latched expiry, unknown-outcome containment, retained pending locks and ordinary re-entry refusal fit the authorized read-only experiment. Credential/bearer material and raw authentication-body hashes are excluded from the saved projections. There is no automatic repair or product mutation path in the diagnostic.

The complete changed-file inventory contains no production `packages/`, `apps/`, lockfile, architecture, SQL or M5-004 operator change. Root scripts add the focused tests/style coverage and foundation path triggers without removing prior checks. Retained-log whitespace is nonblocking and need not be edited to change the approved head. The historical operator code remains experiment tooling, not a new production service.

## Evidence acceptance and limits

Accept the observed same-context empty-scope agreement and the unavailable-Dashboard receipt as bounded evidence. Do not convert either into a statement about which exact app version was active, why/when grants changed, token equivalence across historical routes, or a Shopify defect.

The strongest working explanation is a released/development configuration-context mismatch. It is an inference supported by current empty declarations and earlier preview observations, not an established causal diagnosis. Historical nine-grant observations remain history; the local nine-scope TOML is not proof of the active released declaration.

GitHub independently returned ten completed successful workflows for the approved head. The PR packet records all at attempt 1. The principal inspected the successful foundation job steps, including the 100-case no-retry stress step. Reported root/focused 49/49/PostgreSQL 159/stress 100/100 results and the two complete fresh local reviews were inspected as evidence, not rerun by the principal. DB-free skips retain their qualifications.

Review method: direct connector source/record inspection and live GitHub reads. All five new source/test/schema files were read in full, alongside root/CI/AGENTS/state/tooling patches, the preceding handoff, register observations, browser limitation, report and full local reviews. The principal did not execute the test suites, inspect every historical log or independently rehash every build artifact, access the local host, or authenticate to Shopify. An attempted public container clone failed at DNS resolution; connector source access remained available. No independent execution is claimed.

## Disposition and next boundary

PR #31 may be normally merged only upon owner authorization at the exact inputs above. This accepts M5-005 within its bounded remit; it does not resolve development access.

M5-004 remains BLOCKED; every product/status/catalog case remains NOT_RUN. Original registers and unused/consumed budgets stay closed. Publication admission, nonempty publication-history preservation, supported-channel/in-flight behavior, native non-CAS limits, genuine RELEASE_BOUND and trusted production recovery sources, and remaining G7 are not closed. M6/M7, production activation and launch remain unauthorized.

The next authorized proposal is **M5-006 — released-configuration checkpoint**, a two-view existing-session inspection with documentation only. No new diagnostic program, API sample or automatic remediation is justified by this evidence. The owner launch must separately authorize that bounded inspection.

## Primary review records

- [M5-005 report](https://github.com/Optidigi/insignia/blob/dc9db629559d5fa7049de2d0d3fed28d53a08fb4/docs/delivery/M5-005-REPORT.md)
- [Live register](https://github.com/Optidigi/insignia/blob/dc9db629559d5fa7049de2d0d3fed28d53a08fb4/docs/delivery/evidence/m5-005/live/register.json)
- [Unavailable native views](https://github.com/Optidigi/insignia/blob/dc9db629559d5fa7049de2d0d3fed28d53a08fb4/docs/delivery/evidence/m5-005/native-views.json)
- [Diagnostic source](https://github.com/Optidigi/insignia/blob/dc9db629559d5fa7049de2d0d3fed28d53a08fb4/scripts/m5-005/diagnostic.mjs)
- [Permanent tests](https://github.com/Optidigi/insignia/blob/dc9db629559d5fa7049de2d0d3fed28d53a08fb4/scripts/m5-005/diagnostic.test.mjs)
- [Spec review](https://github.com/Optidigi/insignia/pull/31#issuecomment-5943958965)
- [Standards/security review](https://github.com/Optidigi/insignia/pull/31#issuecomment-5943959159)
