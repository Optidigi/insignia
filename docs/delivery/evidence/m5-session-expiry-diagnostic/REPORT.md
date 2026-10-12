# M5 session-expiry diagnostic

The owner reports Authentication required inside Insignia while editing, before Save. The corrected PR95 client retry is deployed. At 2026-10-12T16:31:19Z the selected safe runtime logs show two SESSION_IDENTITY_REJECTED events after successful authenticated requests. Route correlation and exact failed claim remain unknown; no native expiry cause is claimed.

The existing editor polls every five seconds and clears private state on terminal 401/403. Preserve that authorization fence. No client, server HTTP status, retry count, token verification, storage, Save, publication or freshness contract changes in this slice.

Reproduction through the real SDK adapter shows a signed token expired by one second, still admitted by the SDK clock allowance, is correctly denied by the application but classified as identity mismatch. The test failed with expected SESSION_TOKEN_TIME_REJECTED and actual SESSION_IDENTITY_REJECTED. The correction moves the existing strict expiry predicate after SDK verification and before identity-shape validation, emitting the existing fixed time-rejection stage. No tolerance is added; no token/claims/provider body/staff identifier is logged.

Tests reuse the existing adapter table and synthetic signing helper: equality and one-second-expired controls, plus existing signature/audience/time/identity/secret-rotation controls. All Shopify adapter tests pass: 371/371. Focused production HTTP diagnostics and client one-retry controls pass: 4/4. Package build passes. Native classification under this correction remains NOT_RUN until exact source/review/CI and deployment qualification. The existing product10519322493211 and config4dbbe8f6-8162-4271-9819-fd485f7d65f6 must be reused; no replacement or Publish attempt is authorized by this report. M5/G7 remains open.

Primary platform evidence: [Shopify ID tokens](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens) states that App Bridge can return a cached token with less than a full minute remaining. This supports examining expiry; documentation does not establish this native failure's cause.

Owner clarification: the message appears inside Insignia, rather than a Shopify-owned popup. The safe selected-stage read is read-only; no credentials or raw provider bodies were captured. One local invocation mistakenly named nonexistent `test:boundaries`; its missing-script failure is preserved and the actual `check:boundaries` command is used instead.
