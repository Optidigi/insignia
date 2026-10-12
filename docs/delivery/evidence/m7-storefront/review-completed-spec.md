# Completed M7 Spec/correctness review

Independent native reviewer `/root/m7_final_spec`, read-only frozen checkout. Base `31b92db714fc1bb90f4f2b417361c58c0deb2cf4`; head `2ca51d5b5d1772aeda7982f999bcc771ed9d7f2b`; tree `656d78bb5743ba38613b2c45d88b4fc9123dce2b`. Full slice and interacting M4/M5/M6 contracts inspected.

P2: customizer renewal adopted a fresh cart baseline while submitting the old desired vector, allowing external quantity/removal edits to be reversed. Plan §§4.4/8.4 require complete-subset review.

P2: restored historical design revision/hash remained in new proposals after compatible republish, so current-publication validation rejected repricing. Plan §8.4 distinguishes valid historical offers from unaccepted current-config review.

Prior core findings closed in source: fresh variant availability participates in preparation and serialized issuance; FX provenance refresh alone does not change material equality when resolved economics remain identical; command admission precedes signing and completed application identity remains stable.

Cumulative architecture aligned: pure domain/pricing, isolated Shopify adapter, immutable quote plus additive renewal evidence, owned replay, existing M6 resource authority, frozen whole-quote v2, Preact state separate from Konva and non-authoritative Ajax reconciliation. UI findings require correction before a clean correctness verdict.

Limits: source/diff/test inspection, no tests independently rerun, DB writes, credentials or native calls. Read-only instructions are not a filesystem/connector security sandbox. Persistent ambiguous-cart latching has no implemented reconciliation/reset path; retain its operational limit explicitly. Follow-up impact review records final disposition separately.
