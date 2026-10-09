**CHANGES_REQUIRED — Standards/security**

1. **P1 — [shopify-webhooks.ts:383](/home/serveradmin/insignia-m5-retention-worktree/packages/database/src/repositories/shopify-webhooks.ts:383): unsigned topic authorizes irreversible erasure without qualified obligation eligibility.** This violates the owner’s “only when not discarding sole obligations” condition and the supporting spec’s preservation of uncaptured privacy/economic facts under plan §§10.4/11.

   The [retained advisory](/home/serveradmin/insignia-m5-retention-worktree/docs/delivery/evidence/m5-transient-webhook-retention/eligibility-advisory/report.md) demonstrates accepted synthetic privacy/order bodies containing additional Shop identity fields. Identical signed bytes relabelled `app/uninstalled` are admitted and subsequently erased while pending, including an unverified order identity. HMAC authenticates bytes, not topic. The selector checks neither captured obligations nor independent destructive eligibility. A processed-only restriction remains insufficient: uninstall processing also permits erasure of the mixed privacy fixture without privacy capture.

   **Smallest fix:** exclude ambiguous/unqualified bodies from automatic erasure and report bounded overdue blockers until body-bound eligibility establishes that required facts are captured or safely discardable. Preserve the mixed-body negative controls. This requires neither a new economic store nor full M10 implementation.

Ordinary fixtures reject before durable receipt. Native overlap remains **unproven**; this finding establishes a local application-contract failure, not a native exploit.

Verified clean worktree, commit list, and three-dot comparison:

- Base/effective merge-base: `7fc8688b2d59c191486771192d4f466cbc226703`
- Head: `e20c3e904fc5940b41892265d788ed1046b8160c`
- Tree: `9cd495db19fca49fa9972adf789aebefed296a09`

Static local review only; no edits, tests/builds, credential reads, network/service access, or delegation. No credential/network isolation claim. Historical failures remain failures; uninstall security remains RED. Natural exact-head attempt-1 CI is unverified/pending. Deployment, native safety and M5/G7 acceptance remain unqualified.

Actual runtime model/effort metadata was unavailable; I cannot attest GPT-6.1-sol/high.