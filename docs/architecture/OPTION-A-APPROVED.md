# Required-product policy: Option A approved

**Decision date:** 27 September 2026.  
**Status:** APPROVED by the product owner in the Insignia Rewrite Project.  
**Owner response:** “Option A is fine”.  
**Supersedes:** the unresolved A/B choice in `POLICY-GUARANTEE-DECISION.md`, accompanying principal review PR-010. Historical proposals and receipts remain unchanged.

## Adopted boundary

V1 relies on correctly published, access-controlled app-owned Shopify policy and correctly operating Shopify Function inputs as trusted enforcement state. Buyer-controlled cart attributes are not authoritative policy.

Insignia must reject invalid or missing authorization for identifiable required merchandise, bad signatures/keys, incorrect materialized pre-discount prices, and detectable incomplete, malformed, pending, mismatched or wrong-installation policy. Normal unrelated merchandise is not forced through a catalogue-wide authorization or outage mechanism.

**Accepted residual risk:** unexpected complete loss or coherent rollback of all trusted product-policy evidence, outside the supported publication contract, can make a formerly required unsigned product appear unmanaged or optional. A plain purchase could complete before detection. Reconciliation cannot undo that purchase. This is an incident to prevent, detect, contain and recover from, not a cryptographically eliminated failure mode. No failure-frequency or detection-latency claim is made.

Application-controlled unsafe changes remain defects. The publisher must not deliberately erase management evidence while leaving a required product purchasable, call a known-incomplete write complete, or use reconciliation as a justification for known unsafe publication. Interrupted or ambiguous operations remain pending/error until resolved.

## What the approval does not do

It does not approve the current publication implementation, imply a Shopify propagation/linearizability guarantee, freeze two product fields as the permanent representation, authorize routine merchant-product archival, adopt whole-quote v2, set a product/cart capacity, or pass G6 or M0.

Required customization still means required for all purchases under the supported enforcement conditions. Existing valid accepted quotes retain their historical terms and authorized lifetime; policy edits alone are not a new repricing or revocation mechanism.

The original joint-loss *decision* is closed. Production publication/activation, detectable-fault handling, operational reconciliation and the other gate criteria still require implementation/evidence. Do not present the accepted residual as an unanswered owner decision again.

## Approved repository amendment

In the next authorized work package, update `docs/architecture/decision-ledger.md` and relevant parts of `docs/architecture/implementation-plan.md` to version 1.2, with this decision and only directly necessary status/consistency corrections. Preserve previous versions through their existing Git history and fixed references. Keep all unrelated product and architecture decisions intact.

Replace obsolete blanket “all gates NOT RUN” assertions with an accurate pointer to the maintained evidence register: partial observations have been reviewed; no overall gate has been accepted. G7/G8 are still required unexecuted gates, not silently deferred out of M0. Whole-quote v2 stays an explicitly authorized prototype exception pending adoption.

## Decision provenance

- Principal-approved PR #10: base/effective merge base `eaa386c90786e560d49f8311878c95d26cc3c7b8`; head `9941f68316316a3cad07885d6e78b067e6784fbd`.
- Prior proposal: `POLICY-GUARANTEE-DECISION.md` supplied with `insignia-pr10-review-and-decision.zip`.
- Owner's current approval is the authority for Option A. This document is the principal's transcription of that approval, not an independent claim that a development gate passed.
