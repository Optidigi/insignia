**CHANGES_REQUIRED — Spec/correctness**

1. **P1 — [shopify-webhooks.ts:383](/home/serveradmin/insignia-m5-retention-worktree/packages/database/src/repositories/shopify-webhooks.ts:383)**  
   Destructive eligibility relies on the unsigned indexed topic, violating the owner’s no-sole-obligation-loss condition and [the supporting preservation contract](/home/serveradmin/insignia-m5-retention-worktree/docs/delivery/M5-TRANSIENT-WEBHOOK-RETENTION.md:32). The retained advisory demonstrates application-accepted mixed privacy/order bodies also accepted as uninstall, then erased while pending/unverified without obligation capture. Ordinary relabelled fixtures were rejected; native overlap remains **unproven**.  
   Smallest fix: keep ambiguous/unqualified bodies as overdue blockers until body-bound erasure eligibility is qualified, and add the retained mixed-input regression. A processed-only filter is insufficient.

2. **P2 — [webhook-retention.test.mjs:357](/home/serveradmin/insignia-m5-retention-worktree/apps/worker/test/webhook-retention.test.mjs:357), also :458**  
   Both restricted-role tests create passwordless LOGIN roles and clear their connection passwords. The [committed CI](/home/serveradmin/insignia-m5-retention-worktree/.github/workflows/m3-runtime.yml:55) uses password-authenticated PostgreSQL, so these connections fail before testing grants. This repeats the SCRAM failure already documented in M5-024 and prevents the [required exact-head qualification](/home/serveradmin/insignia-m5-retention-worktree/docs/delivery/operating-model.md:52).  
   Smallest fix: give each disposable role a fresh synthetic password and use it in its connection URL, following `queue-privileges.test.mjs`; retain the permission-denial assertions and qualify under password authentication. This is a static finding, not a claimed current CI failure.

Verified clean worktree, six-commit list and `base...HEAD` comparison:

- Base/effective merge-base: `7fc8688b2d59c191486771192d4f466cbc226703`
- HEAD: `e20c3e904fc5940b41892265d788ed1046b8160c`
- Tree: `9cd495db19fca49fa9972adf789aebefed296a09`

Limits: static local source/Git/evidence review only; no execution, tests, credentials, network or delegation. Actual GPT-6.1-sol/high provenance was not independently exposed. Historical failures remain failures; current-head CI remains unverified. Generic uninstall authority remains RED. No native proof, isolation, deployment qualification or M5/G7/principal acceptance is claimed.