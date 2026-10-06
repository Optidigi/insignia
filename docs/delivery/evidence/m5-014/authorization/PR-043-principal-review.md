# PR #43 — external principal review

**Verdict: APPROVED for normal merge.**

Exact binding:
- base/effective merge base `9d896e824ebf3beb5e560ce89e9873799869f6c5`
- head `4ab249b764a58a08fb6599a2200d5214458da252`
- tree `3bff5ab4b8a9beee4d772e9a2e00869783cea3f5`
- final CI 10/10 SUCCESS, all attempt 1
- native GitHub reviews: none

M5-013 is accepted as SETTLED / FINAL_ARCHIVED_UNPUBLISHED.

Exact fixture `gid://shopify/Product/10490211467547` was DRAFT/effectively unpublished before cleanup. One status-only ARCHIVED update was sent, then one exact final read verified ARCHIVED and effectively unpublished. Actual accounting: auth1/read2/update1, no retries, pending null. ACK and final updatedAt were both `2026-10-06T16:26:27Z`; equality is observed evidence, not the cleanup settlement contract.

The fresh M5-013 register is closed/sealed. No further operation on this fixture is needed or authorized.

The remaining production issue is M5-011's availability-hold contract: exact updatedAt equality and unchanged legacy effective-publication membership are too strong for ACTIVE→DRAFT. Shopify documents Product.updatedAt as broad last-modified metadata, not CAS. Configured publication intent and effective visibility need separate versioned representation.

Owner forwarding of M5-014 authorizes only the local/off-store implementation described in the brief.
