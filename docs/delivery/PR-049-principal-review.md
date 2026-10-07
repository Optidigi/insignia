# PR #49 — external principal review

**Verdict: APPROVED for normal merge as truthful BLOCKED_RELEASE_BOUND M5/G7 evidence.**

Exact binding:
- base/effective merge base `407608ab929e703cd2b10972de93cf00c58aa9df`
- approved head `19e069a32c2f97f0316208ebbb7c970ef309c31a`
- approved tree `170edf1de05fb07ad42e8f0bc15771996531d2cf`
- final-head workflows: 11/11 SUCCESS
- native GitHub reviews: none
- fresh GPT-6.1-sol/high reviews: CLEAR / CLEAR

Accepted source result: the admin publication flow, durable v3 activation integration, stale-edit/reentry/recovery behavior, authorization fencing and local G7 coverage are source-ready with no unresolved material finding.

Accepted live result: `BLOCKED_RELEASE_BOUND`.

Current Active app version `1153019904001` / `insignia-3` still has `application_url=https://example.com`; one designated-installation cold launch confirmed the Insignia iframe loads that placeholder. No fixture, provider mutation, scope change, app release or Function deployment occurred.

`https://insignia.optidigi.nl/admin/products` is a credible candidate but not yet an executable release target. The origin responds over HTTPS and root serves an existing login app, but ownership/routing/collision isolation, deployment identity, `/_astro/` and `/api/admin/products` routing, readiness and Function/release binding remain unverified.

PR #49 may be normally merged at the exact approved refs. M5/G7 remain open. Next slice: M5-019.
