# Cloudflare alert Worker contract — 18 October 2026

Research only, using official current documentation and the preceding [account research](cloudflare-alert-email-2026-10-18.md). Owner accepted `Insignia Alerts <insignia-alerts@optidigi.nl>` → `admin@optidigi.nl` and an independent outage check. This note makes no deployment, entitlement or delivery claim; no credentials were read and no provider mutations or messages were performed.

## Smallest deployable shape

Recommendation: one module Worker with authenticated `POST /v1/heartbeat` and `POST /v1/alerts`, a one-minute scheduled handler, one SQLite Durable Object holding monitor/dedup state, and one fixed-destination email binding. The Worker runs outside the VPS; its scheduled handler checks heartbeat age even when the VPS cannot run. Cron invokes `scheduled()`; configure `triggers.crons = ["* * * * *"]`. Cron changes can take up to 15 minutes to propagate, so qualify deployed execution before relying on it. [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

Use a single named Durable Object for this installation, not process memory or a VPS file, to serialize heartbeat/incident transitions and atomically persist claims before sending. SQLite Durable Object storage supplies transactional persistent state. Never perform the external email send inside a retriable storage transaction. [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

Proposed operational defaults (engineering choices): heartbeat each minute; alert after five minutes without an authenticated heartbeat; one recovery notice after heartbeat resumes; at most one sustained-incident reminder per six hours; total mail cap 20/day including watchdog, with duplicates and cap exhaustion recorded. Do not report the whole application healthy solely from heartbeat: heartbeat should carry fixed aggregate status codes for availability, backup age, stalled processing and overdue deletion; thresholds must match the implementation contracts. Before first heartbeat, remain explicitly unarmed and report readiness as unqualified; qualify missing-heartbeat detection after arming.

Use a dedicated rotatable relay secret stored as a Worker secret and a protected VPS credential, never the account email API token. Authenticate before processing content, bound body to 4 KiB, require JSON, reject unknown fields and arbitrary URLs. Proposed schema: version `1`, opaque event ID (maximum 128 ASCII characters), timestamp within five minutes, fixed component/event/severity enums, incident ID and nonnegative aggregate count only. Persist event ID replay/dedup records for seven days; bind ID to canonical payload hash and reject conflicting reuse. Construct all mail content in trusted code; accept no sender, recipient, subject, headers, HTML, attachments, customer data or raw exception text. Heartbeat endpoint does not directly send mail.

## Exact send contract

The documented binding configuration is:

```jsonc
{
  "send_email": [{
    "name": "ALERT_EMAIL",
    "destination_address": "admin@optidigi.nl"
  }]
}
```

`destination_address` restricts the binding to one recipient. Keep sender fixed in code. The docs present sender and recipient restrictions as separate choices; do not assume combining `allowed_sender_addresses` with `destination_address` works until Wrangler deployment and runtime rejection tests qualify it. The sender domain must be onboarded. [Send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)

Minimal valid structured send, called only after authentication, validation and a persistent send claim; this is a helper, not a publicly callable endpoint:

```ts
async function sendQualificationNotice(env: Env): Promise<string> {
  const result = await env.ALERT_EMAIL.send({
    from: { email: "insignia-alerts@optidigi.nl", name: "Insignia Alerts" },
    to: "admin@optidigi.nl",
    subject: "[Insignia production] Alert route qualification",
    text: "Automated operational notice. Alert route qualification only."
  });
  return result.messageId;
}
```

The binding signature is `send(message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult>`. Structured fields require `to`, `from`, `subject`; addresses accept strings or `{ email, name? }`; optional fields include `text`, `html`, `cc`, `bcc`, `replyTo`, attachments and headers. Result is `{ messageId: string }`; errors carry `.code`. Use generated Worker `Env` types and pin/qualify the tooling that supports this newer structured API. No MIME library or `EmailMessage` import is required. [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)

## Verification once, without changing inbound mail

A fixed-recipient binding is a restriction, not verification. For the chosen verified-destination route, register and verify `admin@optidigi.nl` in the account. Verified-destination sends are free on all plans; arbitrary-recipient sending requires Workers Paid. Worker execution and storage have their own resource accounting; qualify the current account without enrolling or upgrading. [Pricing](https://developers.cloudflare.com/email-service/platform/pricing/)

Before initiating verification, read the exact-recipient destination list, including pending entries. If absent and separately authorized to send the verification message, submit exactly once:

```http
POST /accounts/{account_id}/email/routing/addresses
Content-Type: application/json

{"email":"admin@optidigi.nl"}
```

Record returned ID and creation attempt; the response's `verified` timestamp is null until verification completes. On timeout, re-list instead of blindly recreating. [Destination API](https://developers.cloudflare.com/api/resources/email_routing/subresources/addresses/methods/create/)

Ask the mailbox owner to complete Cloudflare's verification link; do not bypass human confirmation. Pending addresses can be managed and verification emails resent in Destination Addresses, but resend only deliberately, not on a retry loop. Registering this destination does not require authorizing root MX changes or enabling inbound Routing. Preserve TransIP inbound mail and existing root DNS/preview settings. [Destination management](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)

## Deduplication and unknown delivery

Persist `claimed` before invoking send; on result, persist `submitted` with message ID. A crash/timeout after claim or before durable result becomes `unknown`, never automatically `unsent`. Repeated event IDs return their existing state without another send. The documented Worker interface provides no idempotency-key field and its result supplies no recipient delivery breakdown; do not claim exactly-once delivery or treat returned ID as inbox receipt. [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)

Reconcile unknown outcomes through available provider activity/message IDs; later bounded reminders use a new reminder identity and may duplicate an earlier unknown delivery. Distinguish explicit API rejection, submitted, unknown, server-accepted delivery and confirmed inbox receipt. Cloudflare retries soft bounces; recipient-server acceptance does not establish inbox placement or reading. Do not resubmit merely because delivery is delayed. [Email lifecycle](https://developers.cloudflare.com/email-service/concepts/email-lifecycle/)

Qualification requires invalid-auth/schema/replay rejection, fixed-recipient negative tests, concurrent dedup and crash-window tests, real sanitized inbox receipt with authentication headers, and an armed VPS-outage/recovery drill. Until those pass, report the route unqualified. This research authorizes no send, DNS change, paid enrollment, root-mail reconfiguration or application rollout.
