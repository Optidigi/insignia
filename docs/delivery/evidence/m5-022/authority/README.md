# Insignia — PR #52 approval + M5-022

PR #52 is approved as truthful blocked M5/G7 evidence.

Current real observation:
- product picker loads in the owner's normal Shopify browser;
- Search returns `Authentication unavailable`;
- no fixture or merchant write occurred.

M5-022 is the integrated authentication + trusted-readiness closure slice.

It must:
1. correct the Shopify ID-token refresh contract;
2. identify the exact throwing authentication stage without logging secrets;
3. wire the existing server-owned trusted release/readiness contracts;
4. deploy the reviewed web runtime only — no Shopify app version/release change;
5. if authentication/readiness passes, continue directly through the remaining real G7 + one disposable merchant-flow fixture.
