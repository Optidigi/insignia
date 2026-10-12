# Completed M7 Standards/security review

Independent reviewer `/root/m7_core_security_review`, frozen full candidate `2ca51d5b5d1772aeda7982f999bcc771ed9d7f2b`, tree `656d78bb5743ba38613b2c45d88b4fc9123dce2b`, base `31b92db714fc1bb90f4f2b417361c58c0deb2cf4`.

P2 functional integration: the customizer retained a renewal UUID per quote indefinitely. A later renewal after expiry replayed the previous completed expired set. Keep identity for uncertain retries; retire it after acknowledged completion. Functions still reject expiry; this is not an authorization bypass.

Prior P2 after-effect throttling closed: serialized reservation occurs before provider/signing work, pending retries consume committed rate budget, pending/completed commands share bounded capacity and atomic completion returns the same application on replay. Saturation, no-issuer and concurrent-completion coverage inspected. Tentative r1 missing-readiness concern was retracted: public preparation calls readiness, including renewal serialized preparation.

No additional material Standards/security finding. Domain, Shopify and renderer boundaries remain intact; immutable economics and v2 wire bytes are unchanged. Tenant/generation/owner replay, current inventory/readiness, asset-bounded private retention, cascading cleanup and restricted DB-clock erasure remain connected. Ajax uses current keys, preserves ordinary lines and latches ambiguous writes before dispatch without retry. Bootstrap is explicitly gated and consumes existing trusted release evidence without restamping. Generated/retained browser chunks are secret-scanned.

Misleading buyer post-order upload copy was reported; root changed it to merchant-only later attachment outside the frozen source. Follow-up impact review records final disposition.

Limits: read-only source/test inspection, no independently rerun tests, credentials, DB/provider effects or native acceptance. No CODING_STANDARDS/CONTRIBUTING source was found; repository contracts govern. Read-only role is instructional, not enforced connector isolation.
