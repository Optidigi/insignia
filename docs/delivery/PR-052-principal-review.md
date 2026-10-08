# PR #52 — external principal review

**Verdict: APPROVED for normal merge as truthful blocked M5/G7 evidence.**

Exact binding:
- base/effective merge base `db4265228b901a99cd4e3602ee0c387065080cc6`
- approved head `39c77ee73f7534e01a47853968eec8c139d917c6`
- approved tree `315cc4cf18c3c1eef0cb0d8fa3c542fc5170bed5`
- final-head CI: 10/10 naturally applicable workflows SUCCESS, attempt 1
- fresh completed-change GPT-6.1-sol/high reviews: CLEAR / CLEAR
- native GitHub reviews: none

Owner observation accepted exactly:
> I see the search product page, but when I click search I get: 'Authentication unavailable'

This proves picker reachability and an authenticated Search failure. It does not establish the throwing internal substep.

Static source inspection narrows the failure:
- local ID-token verification exceptions are converted to invalid identity and ordinary 401;
- `Authentication unavailable` is emitted only when `services.authenticate()` throws;
- downstream throwing candidates include online token exchange, provider installation read, and durable tenant/current-installation reconciliation.

The exact failing substep remains unknown.

A separate source issue is also confirmed: production activation readiness is deliberately unwired/fail-closed (expected build null, no trusted release-record source, Functions unknown, trusted merchant day unavailable). This is not asserted to cause Search authentication failure, but it must be wired before M5 can pass.

Current Shopify guidance for embedded apps uses App Bridge ID tokens + token exchange. Invalid/expired token-exchange input should obtain a fresh ID token; the backend can signal retry with HTTP 401 plus `X-Shopify-Retry-Invalid-Session-Request`. The current adapter detects refreshable exchange errors but loses that distinction into the generic 503 path.

PR #52 may be normally merged at this exact head.

Next authority: M5-022 — auth refresh/diagnosis + trusted-readiness wiring + web redeploy; if the frozen corrected build passes, continue directly through real G7 and one disposable merchant-flow/v3 activation.
