# Customer artwork notification sender

The customer email flow is distinct from the operator-alert binding. Verified full-payment insertion plans one durable notification only when retained artwork remains missing. A merchant-shared link can work before payment. No sender automatically drains historical records during development qualification.

`apps/worker/src/customer-artwork-email.ts` uses Cloudflare's sending REST API at `POST /accounts/{account_id}/email/sending/send`. The API accepts an account-scoped API token; Cloudflare documents the permission as **Email Sending: Edit**. Scope the token to the existing Optidigi account only. DNS editing, API-token management, Billing Read and Workers deployment are not runtime sender requirements. Account-level credentials may send from onboarded domains, so the application adapter additionally fixes `from` to `noreply@optidigi.nl`. See [REST authentication/response rules](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/) and [token permission requirements](https://developers.cloudflare.com/email-service/api/send-emails/smtp/).

An existing owner-authorized application email token can be reused. On 5 November, the existing Optidigi token passed account/status/limit checks and one explicitly authorized `noreply@optidigi.nl` → `admin@optidigi.nl` transport test received a Cloudflare acknowledgement/message ID. Insignia’s private development profile is prepared outside the checkout; no token was printed, committed, replaced in the other applications or newly created. This is transport evidence, not inbox delivery or customer-recipient qualification.

Arbitrary customer recipients require a qualified Email Sending entitlement; verified destination sending alone does not prove that capability. The existing domain being enabled and its DNS being ready establish those narrower facts only. See [Cloudflare Email Service availability](https://developers.cloudflare.com/email-service/).

Keep the reusable API credential outside the checkout in an owner-readable regular file (0600), with no symlinks. `loadCustomerArtworkEmailProfile` validates custody and expected app/account binding. Example shape, with placeholders rather than credentials:

```json
{
  "version": "cloudflare-customer-artwork-email-v1",
  "accountId": "<existing-account-id>",
  "apiToken": "<privately-supplied-account-scoped-token>",
  "from": "noreply@insigniacustomizer.com",
  "appOrigin": "https://app.insigniacustomizer.com",
  "mode": "development"
}
```

Development mode sends only to the explicitly allocated `admin@optidigi.nl` address and labels the message as a development test. It does not establish a real customer order or authorization. Customer mode also requires a server-owned sending-qualification port; a configuration string alone does not establish entitlement or recipient-field access. The connected Cloudflare tool credential cannot be exported into the app.

`X-Insignia-Notification` is trace metadata, not provider idempotency. The durable notification claim owns one dispatch. Explicit provider acknowledgement with message ID settles SENT (queued acknowledgement is not proof of inbox delivery); documented structured no-effect denials may enter bounded recovery. A timeout, unknown gateway response or unresolved send settles UNCERTAIN, and is never blindly retried. Original design cleanup erases link and notification authority. Offline restore drops restored intents/capabilities and rotates the link epoch so old URLs cannot revive.

A scoped read on 5 November initially returned HTTP200 with GraphQL `ACCESS_DENIED` for the protected order-recipient query. After the owner completed the separate Partners login, the existing Insignia app's **Email** field was selected for this specific reason: “Send customers secure links to upload missing artwork for their paid customized orders.” The existing general-data reason remains unchanged; names, phone and address were not selected. No distribution change, App Store submission or data-protection attestation was made. A fresh current-installation query at `2026-11-05T22:30:04.651Z` then returned HTTP200 without GraphQL errors and a nonempty recipient, with the same authorization before/after. No recipient value was logged or emailed, and it did not match the sole authorized admin test destination. This qualifies that bounded development field read, not production review or arbitrary-recipient Cloudflare entitlement. See Shopify's [protected customer data workflow](https://shopify.dev/docs/apps/launch/protected-customer-data).

Before enabling customer delivery, qualify the actual sender, secure-link endpoint, protected recipient-field access, installed least-privilege roles, absolute retention, worker scheduling and received-message authentication. A successful development test is only the allocated sender-to-admin result, not arbitrary-recipient eligibility or a complete order journey.

## Composed runtime

The web process owns the notification dispatcher because its existing database role owns the narrow link/notification capabilities. The ordinary queue consumer does not gain raw grant or merchant attachment writes. The middleware starts one lazy singleton only when both `INSIGNIA_CUSTOMER_EMAIL_ENABLED=1` and `CUSTOMER_ARTWORK_EMAIL_PROFILE` are supplied. Without these settings, it allocates no sender, timer or database pool. The runner drains at most one notice per 60 seconds, coalesces overlapping calls, uses an unreferenced timer and exposes explicit `runOnce`/`stop` lifecycle methods. Multiple instances still require the same durable one-use database claim.

Development mode processes no queue row by default. A notice becomes eligible only in one of two ways:
- It is listed in `INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_NOTICES`, an explicit JSON array of up to 10 notification UUIDs.
- It was planned at or after `INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_SINCE`, a canonical ISO instant such as `2026-11-11T23:00:00.000Z`. Set it to the enabling time so earlier notices are never backfilled. A malformed value makes the runtime unavailable rather than permissive.

The recipient is fixed to the allocated admin address (`admin@optidigi.nl`) and no customer email field is read. The sender itself also refuses any other recipient in development mode. This prevents a dev deployment from draining historical notifications or mailing a buyer address such as a dev-store placeholder.

Customer mode requires `CUSTOMER_ARTWORK_EMAIL_QUALIFICATION_PROFILE`: a private owner-readable evidence-selector file with exact fields below. It references real separately qualified Cloudflare entitlement and Shopify protected-recipient observations; the application never creates or refreshes this evidence. The durable reviewed grant binds the exact account/app/sender and authorized tenant/installations. An optional expiresAt is enforced when it records a genuine provider/token/evidence deadline; there is no daily human requalification policy. Removing or invalidating the grant revokes customer sending. The runtime rechecks them before protected reads and dispatch. The customer recipient reader uses the existing active-installation, scoped, usable offline credential without inventing a recipient or expanding the safe order-label query. Missing/denied/expired recipient authority leaves the notification pending and reports runtime unavailability.

```json
{
  "version": "customer-artwork-email-qualification-v1",
  "accountId": "<existing-account-id>",
  "appOrigin": "https://app.insigniacustomizer.com",
  "sender": "noreply@insigniacustomizer.com",
  "arbitraryRecipients": true,
  "protectedOrderEmail": true,
  "qualifiedAt": "<actual-original-observation-time>",
  "expiresAt": "<optional-genuine-provider-or-evidence-expiry>",
  "providerEvidenceRef": "<owned-provider-evidence-reference>",
  "recipientEvidenceRef": "<owned-recipient-evidence-reference>",
  "tenantScopes": [
    { "shopId": "<qualified-tenant-id>", "installationGeneration": "<actual-generation>", "appClientId": "<actual-app-client-id>" }
  ]
}
```

Supplying placeholder values or simply changing the mode is not qualification. Customer delivery remains off until real credential/evidence custody exists. No new paid account, DNS record, app scope, real customer send or notification backfill follows from this template.

Unreadable/missing customer email leaves the notice pending and sets a bounded five-minute retry deadline, allowing other eligible notices to proceed. It logs runtime unavailability and sends nothing. Known no-effect provider denials use recurring safe reconciliation through the original retention deadline: five-minute initial backoff, then hourly backoff after twelve actual attempts with continued operator alerts. The diagnostic attempt count remains monotonic; temporary quota/auth denials do not create a permanent twelve-attempt stop. Every recurrence repeats active installation/profile/payment/missing-slot/retention checks; uncertain dispatch is never automatically reclaimed. The monitor sees only lifecycle metadata and reports stalled/uncertain delivery plus overdue capability expiry.
