# M5 Partner subscription endpoint correction

M5/G7 remains NOT_PASSED. The owner reports “Readiness checked. Publication still requires current eligibility.” on the deployed coordinated-Publish build. This attests successful authenticated status observation, not product search contents, subscription eligibility, signing or activation.

## Reproduced boundary

The deployed runtime uses INSIGNIA_PARTNER_ORGANIZATION_ID=200969036, taken from the exact-app Dev Dashboard management organization. Its existing Partner credential returns HTTP401 for the production activeSubscription query. A distinct read with only the endpoint organization changed to4697030 returns HTTP200, exact App429028933633/Shop105501393179, the genuine existing development handles and all five owner-authorized M5 features through production tenant binding and entitlement projection. Three read requests, zero mutations; original failures are retained. These observations expire and cannot authorize later Publish.

Shopify requires the Partner token to belong to the queried Partner organization ([authentication](https://shopify.dev/docs/api/partner/2026-01#authentication)); activeSubscription requires Manage apps ([contract](https://shopify.dev/docs/api/partner/latest/active-subscription)). The native differential, original credential custody and historical qualified subscription read establish this correction; a management organization ID alone does not establish this endpoint. No credential rotation is required by the observed comparison.

## Smallest correction and qualification

The additional Compose overlay changes only web.environment.INSIGNIA_PARTNER_ORGANIZATION_ID to4697030. Reuse the exact reviewed web image21f2a20e372b23e5a334cd2a1fea26ed4e9f17e3c625f5c04f40bae8a6673977 and the existing credential. Keep management collection bound independently to its native exact-app organization; do not change the collector, signing,30-second freshness, policy, Functions, Shopify scopes/version, workers, database or legacy apps.

Before deployment: prove actual Compose merge semantics, run style/secret/integrity checks, obtain fresh independent Spec and Standards/security CLEAR reviews, and qualify natural exact-head CI. Resolve the actual production Compose stack privately and require one-key-only semantic delta. Freeze hashes and reserve one web recreation before dispatch. Preserve the six current configuration files as rollback; rollback changes configuration, not immutable evidence. Ambiguous command/readback stops for reconciliation without repetition.

After deployment: exact image/security/mount/env parity, healthy web, unchanged worker/database and private verifier, then a fresh production-port subscription read using the configured endpoint. Only after that passes prepare the one allocated merchant fixture and proceed through owner-browser configure/preview/save/conflict/recovery/Publish/activation/reopen. No fixture or signing attempt has occurred in this correction.

The preceding web deployment was acknowledged once. Its postcheck stopped on ordered environment-array equality; separate read-only comparison proved exact configured values, image, security, mounts and healthy web/worker/database. The derived settlement receipt explicitly preserves that original failure and records no repeated command. Automated canonical HTTP reads returned403 with unqualified cause; internal origin checks and the owner’s authenticated readiness observation are separate evidence.

## Evidence and limits

Selected diagnosis and derived prior-handover receipts are adjacent. Private captures remain under /home/serveradmin/insignia-pr90-continuation-20261012, mode600, with source hashes and a seven-day maximum retention from12October (earlier applicable privacy deadlines prevail). No token, staff identity, raw provider body or private configuration value is copied into public evidence. This is endpoint configuration qualification, not M5 acceptance or autonomous uninstall/privacy proof.
