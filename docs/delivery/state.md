# Current state and owner/operator checklist

## Active assignment

Updated 11 November 2026. Insignia now runs only on `app.insigniacustomizer.com` (Active `1203782746113`, web main `714e2e2d`, signer main `fb30b947`, worker main `f4ae1f9e`, verifier main `add83af7`, schema 58). Signing keys no longer expire routinely; rewrite-dev signs with non-expiring key 3 through a separate signer process, and retired keys hold no private half. Customer artwork email runs on rewrite-dev in development mode (admin recipient only, web main `714e2e2d`); protected facts are now 9/8/2/8/11 after test order #1009. The combined application and canonical agent documentation are integrated. The existing host alias `prod` serves the allocated rewrite-dev app/store. The cart-line v3 source is deployed there, its candidate is the released Shopify Active version (the single v3 cutover), and both were independently read back. On 11 November 2026 a web-only update deployed main `721bc6b6`: the 5-minute release refresh and the Cloudflare-only origin lock. No production resource migration, new scopes/markets, database reset, history erasure, protected VAT retry, checkout/order/payment or consumed sender/alert drill was performed. The [operating model](operating-model.md) owns permissions; the [specification](../architecture/implementation-plan.md) owns requirements.

### Remaining work and end shape (owner-agreed roadmap, 12 November 2026)

**End shape.** Insignia is a public Shopify app on `app.insigniacustomizer.com`:
- The storefront Designer quotes per-line, quantity-independent signed prices (cart-line v3). Checkout Functions verify them.
- Per-shop signing keys never expire; they live only in the separate signer.
- Customer artwork email goes from `noreply@insigniacustomizer.com` to real buyers.
- Merchants pay the Lean plan ($49.99 / 30 days, with a trial) through Shopify billing.
- Production runs with scoped credentials, off-host encrypted backups (signing wrapping key in separate custody), installed monitoring and alerts to `@optidigi.nl`, a qualified restart and rollback, and a working uninstall/privacy lifecycle.
- Rollout to real merchants happens only after the owner approves.

**Picking this up.**
- Read this section, then the [owner/operator checklist](#owneroperator-checklist) (exact closing evidence per gate) and the [operating model](operating-model.md) (permissions, standing approvals, protected resources).
- Development host alias `prod`; store `insignia-rewrite-dev`.
- Deploy with the [runtime README](../../deployment/m5-runtime/README.md) bounded sequence (checkpoint and restore-verify, migrations and grants, images, readback).
- Release only through the documented profile/binding procedure.

| Phase | Status | What remains | Needs the owner | Done when |
| --- | --- | --- | --- | --- |
| 1 Storefront flow on the new domain | **Done** 12 Nov | — | — | Owner ran the full flow; no deltas. |
| Signing hardening | **Done** 11 Nov | Automatic: key 1 is destroyed from 12 Nov 00:00Z and key 2 from 16 Nov 00:00Z by the worker job. | Optional later: HSM/KMS (e.g. AWS KMS Ed25519) instead of the local signer. | Non-expiring key 3 signs via the signer; retired keys hold no private half. |
| 4 Customer email (development) | **Done** 11 Nov | — | — | Received SPF/DKIM/DMARC pass and order #1009 mailed `admin@optidigi.nl` only. |
| 2 UI acceptance | **Next** | Agent prepares a review checklist of merchant-admin and Designer screens and states (wide and narrow, both themes); fixes findings. | Review and accept (checklist rows "Merchant UI" and "Selected Designer visual fidelity"). | Explicit owner acceptance recorded. |
| 5 Production foundations | Open | Production storage and credentials cutover; off-host encrypted backup plus a full loss-recovery rehearsal (RPO 24 h / RTO 4 h); installed monitoring and alert relay with receiver authentication; restart and rollback qualification. | Allocate credentials and storage. The owner implements server backup in a separate session; it must back up `runtime/signer-secrets/signing-wrap-keys.json` in custody separate from database backups. | The matching checklist rows close with their stated evidence. |
| 6 Commercial readiness | Open | Real $49.99 / 30-day plan, invoice and trial-to-paid; public-app/distribution settings; merchant, market and currency eligibility (EUR); **email proof:** Cloudflare arbitrary-recipient sending entitlement evidence so customer mode can mail real buyers (development mode stays admin-only until then). | Billing, distribution and market choices; obtain the Cloudflare entitlement evidence. | The "Native/commercial eligibility" row closes and customer mode is enabled with real evidence. |
| 7 Uninstall and privacy | Open | Reconcile the VAT installation's original uninstall dispatch against actual provider state; qualify erasure and reinstall fencing end to end. | A concrete allocation for any new effect. | The "Genuine uninstall/privacy" row closes. |
| 8 Rollout | Not approved | First real merchant. | Explicit go. | Owner authorization after the gates above. |

**Small pending checks.**
- From 14 Nov: renewal of an expired quote (needs a cart at least three shop days old).
- Per-visitor and shop limits under load: test locally, not by flooding prod.
- Two minor signer review items remain:
  - web can overwrite the active key's envelope (denial of service only);
  - a millisecond race between a revoke and a signature.
- Remove the legacy query fields from `INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON` once the pre-PR298 rollback image is retired.
- Delete the owner-supplied Cloudflare Rules token when the domain work is final; the owner will say when.

**Owner decisions in force (11–12 November 2026).**
- Signing keys do not expire.
- Insignia lives only on `insigniacustomizer.com`; alert inboxes stay on `@optidigi.nl`.
- The legacy generic `insignia.optidigi.nl` stack is removed. The legacy Stitchs, Superfunny and Custom stacks must keep running untouched.
- The VAT store's leftover old-host uninstall webhook stays.
- The Cloudflare status Worker detects removed services by itself.
- Standing OK for rewrite-dev test-gateway orders.

### Incident: quotes blocked by published-config drift — 12 November 2026, resolved

**Window:** `00:00:29Z` to `00:30:31Z` (about 30 minutes). Rewrite-dev only.

**Cause.**
- The daily destruction job (#325) correctly destroyed key 1 at `00:00:29Z` (window closed at day 20767), and the expected public-config projection dropped it.
- The published Function config (written 11 Nov `19:26:28Z` by the key 3 rotation) still listed key 1.
- Quote readiness required exact equality, so every acceptance failed at `current-readiness`.
- The Functions themselves were unaffected: key 1's window had closed, so it admitted nothing anyway.

**Shopper impact.** Add to cart showed "Your cart could not be updated. Your design is still here. Try again." Two failed attempts are logged, at `00:07:01Z` and `00:28:23Z`. No order was affected.

**The failure was silent.** It was logged only as a generic `UnexpectedFailure`, so neither the shopper nor we got a specific signal. It was found during an owner-requested verification.

**Fix 1: unblock.**
- One compare-guarded write of the published config through the existing publication adapter (`admin.set`, the path the rotation uses), with the app's offline credential.
- Guarded on published `422748e2…` (keys 1, 2, 3) and expected `15821173…` (keys 2, 3).
- Applied at `00:30:31Z`. Readback: `15821173…`, equal to the expected projection, with generation `d79cc783…` and epoch 0 unchanged.
- An acceptance at `00:31:24Z` succeeded, signed with key 3 through the signer. Checkout showed no error.

**Fix 2: permanent (#333, main `271de40d`).**
- `publishedConfigMatches` in `packages/application/src/keys/public-config.ts` is now the single comparison, used by both quote readiness and the owner rotation pre-check.
- It accepts the exact expected config, or the expected config plus keys that are destroyed in the database and whose window has closed. Anything else fails.
- Drift now raises `PublicConfigDriftError` and is logged as buyer diagnostic `PublicConfigDrift`.
- Drift lasting 5 minutes logs `public_config_drift`, at most every 5 minutes.
- **Deploy:** web image `sha256:68572bc7…` (CI run 43130140555), recreated at `01:00:35Z`. The worker and signer are unchanged.
- **Post-deploy live check, `01:01:52Z`:** acceptance succeeded with `signer_sign ok key 3`. The carrier has key ID 3, generation `d79cc783…`, epoch 0, valid through day 20770. Checkout showed $17.45 with no error, and the cart was emptied. No order was placed.

**16 November check.** Key 2 (last day 20771) becomes destroyable from 16 Nov `00:00Z`. The published config will then still list it, and the fix tolerates that. Confirm on 16 Nov that:
- the worker logs `signing_key_destruction` with count 1;
- a Designer Add to cart still succeeds;
- no `public_config_drift` line appears.

The next owner rotation or publication rewrites the config without key 2.

### Separate signer and retired-key scrub — deployed 11 November 2026

**Owner approval, 11 November 2026.** Retired keys lose their private half, a daily worker job destroys closed windows, a separate signer process holds the signing KEK, and one development customer-artwork email test is allowed.

**Code.**
- #325 (scrub, migration 57, daily destruction) and #327 (migration 57 order fix, caught by the checkpoint dry run) are merged.
- #326 (signer, migration 58, grant deltas, compose overlay) is merged. An independent security review found no path for web to reach a seed or the KEK. Its follow-ups are in #326:
  - a dedicated signer uid for KEK custody;
  - rate-limit buckets charged only after scope validation, with least-recently-used eviction;
  - request timeouts;
  - revocation and destruction made final.
- Deployed main `fb30b947`, tree `dbc3ec30`, CI run 43105518442. Web image `sha256:045002c2…`; worker and signer image `sha256:b5cdb5e8…`. Verifier and inspector are unchanged, and no Shopify release was made.

**Deploy sequence (prod).**
1. A DB-only checkpoint was restore-verified with a dry run of migrations 57 and 58 on real data at `21:31:57Z` (schema 56, facts 8/7/2/7/10). Its encrypted copies were disposed at `21:58:41Z`.
2. Migration 57 at `21:53:48Z`: keys 1 and 2 were scrubbed at once.
3. The `insignia_signer` role, migration 58 and `signer-runtime-grants.sql` at `21:53:54Z`.
4. Signer up at `21:54:06Z`: healthy, `signer_listening` with 1 key.
5. Web recreated at `21:54:20Z`, with no KEK variables and the socket directory mounted read-only.
6. `web-signing-envelope-revoke.sql` at `21:54:39Z`.
7. Worker recreated at `21:54:40Z`.

**Readback after the scrub (rewrite-dev).** No envelope remains under the old shared KEK id `m5-runtime-20261011`, and no non-active key holds an envelope.

| Key | State | Days | Private half |
| --- | --- | --- | --- |
| 1 | retiring | 20736–20767 | none; destroyed by the worker from 12 Nov 00:00Z |
| 2 | retiring | 20766–20771 | none; destroyed from 16 Nov 00:00Z |
| 3 | active | 20768–2147483647 | `signing-20261111` |

**Grants.**
- The signer role reads `private_envelope`. Web does not, and has no INSERT on `signing_keys`.
- The worker has no envelope access, and EXECUTE only on `destroy_expired_signing_keys`.
- Web's environment has no `INSIGNIA_SIGNING_WRAP_*` variable. The key file is not visible in web.
- **KEK custody:**
  - The KEK lives only in `runtime/signer-secrets/signing-wrap-keys.json`, owned 10101, mode 0400. See the [runtime README](../../deployment/m5-runtime/README.md#signing-wrapping-key-kek-custody).
  - Five older web compositions that still held the KEK value were shredded at `21:58:36Z`.
- **Old shared KEK:** the worker still needs `INSIGNIA_CREDENTIAL_KEY_*` (`m5-runtime-20261011`), because that is the shop-credential ring for offline tokens. It no longer protects any signing key and cannot be dropped.

**Storefront (default profile; cart emptied).**
- The Designer quoted M×1 at $17.45.
- Add to cart gave one `_insignia_line_v3` (259 chars) with key ID 3, valid through 20770, unit 1745. It was signed through the signer: audit line `signer_sign ok key 3`, 24 ms server-side.
- Checkout showed $17.45 with no validation error. No order was placed.
- The release admission read passed. Protected facts are 8/7/2/7/10. Other sites returned 200.

**Latency.**
- Socket round trip from web: median 0.48 ms, p90 2.0 ms, over 20 calls.
- The first real signature took 24 ms in the signer: active-key read, decrypt and sign, on a newly opened pool.
- That acceptance took 1547 ms end to end.
- The added cost over in-process signing is the socket round trip, about 1 ms.

**Destruction log fix (#328).** The worker's first destruction pass ran (0 keys due), but its success log used an event missing from the logger allow-list, so it reported `SIGNING_KEY_DESTRUCTION_UNAVAILABLE`. Destruction itself was unaffected. #328 is merged (main `f4ae1f9e`). The worker-only image `sha256:7fcf6703…` was deployed at `22:23:58Z` and now logs `signing_key_destruction {count: 0}`. The signer keeps image `sha256:b5cdb5e8…`, since its code did not change.

**Customer artwork email: one owner-approved test, consumed.**
- Sent at `2026-11-11T22:02:08Z` through the customer artwork email sender (`createCloudflareCustomerArtworkSender`), with the development profile, from `noreply@insigniacustomizer.com` to `admin@optidigi.nl`.
- Notification id `4da55deb-2f17-45ee-b89f-380936d95808`. Cloudflare acknowledged it as `sent`, message id `<lubIW02KieKU8MqVGX0zxlsoqHosdDYpQhoH@insigniacustomizer.com>`.
- The upload link in it is synthetic and grants nothing.
- **Received authentication and delivery: qualified** (owner-supplied headers, summary in [evidence](evidence/technical-merchant-completion/customer-email-received-authentication-2026-11-11.json)).
  - Microsoft 365 received it for the development recipient at `22:02:14Z`.
  - SPF pass (mail-from `cf-bounce.insigniacustomizer.com`).
  - DKIM pass for `insigniacustomizer.com` (aligned) and for `cloudflare-email.net`.
  - DMARC pass (`header.from=insigniacustomizer.com`, action none) and compauth pass (reason 100).
  - SCL 1, delivered to the Inbox.

**Customer artwork email enabled on rewrite-dev, development mode, 11 November 2026 (owner approval).**
- **Code:** #330 (main `714e2e2d`) adds `INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_SINCE`. In development mode, a notice is eligible only if its id is listed in `INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_NOTICES` or it was planned at or after that instant. With neither set, nothing is eligible. A malformed value makes the runtime unavailable.
- **Recipient:** development mode never reads a customer email field and fixes the recipient to `admin@optidigi.nl`. The sender independently refuses any other recipient in development mode. Dev-store buyer placeholders such as `test@example.com` are therefore never mailed by Insignia.
- **Deploy:** web image `sha256:b74027ed…`, recreated at `23:45:02Z`, with these settings:
  - `INSIGNIA_CUSTOMER_EMAIL_ENABLED=1`;
  - the existing development profile (`~/.config/insignia/customer-artwork-email.private.json`, 0600) mounted read-only at `/run/insignia/customer-artwork-email.json`;
  - `INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_SINCE=2026-11-11T23:44:59.387Z`.
  - No customer-mode qualification profile.
- **No backfill:** the two earlier PENDING notices (planned 10 Nov `20:49:50Z` and 11 Nov `09:35:27Z`, for earlier test orders) stay PENDING with 0 attempts.
- **Real flow (test gateway, standing approval):**
  - Order **#1009** (`gid://shopify/Order/7582092460315`, `is_test`, USD 25.45 = designed tee M×1 $17.45 + $8.00 shipping). Placeholder buyer `test@example.com`. Placement Linkerborst with "Provide artwork later". Signed by key 3 through the signer.
  - The worker planned notice `246ff984-f379-47d1-988b-663239ea3db9` at `23:49:13Z`.
  - Web sent it at `23:50:07Z` to `admin@optidigi.nl` only: state SENT, 1 attempt, message id `<QCD5JF4Q5NbsESM4S2o1Z8Q2TDxLCG3EPSSN@insigniacustomizer.com>`.
  - No other send occurred.
  - Shopify's own order confirmation to the placeholder address is a Shopify platform email, not Insignia's.
- **Protected-fact baseline is now orders 9, paid 8, refunds 2, bindings 8, lines 11.**
- **Still blocked: customer mode (real buyer addresses).** It needs a `CUSTOMER_ARTWORK_EMAIL_QUALIFICATION_PROFILE` with `arbitraryRecipients: true` and real provider-entitlement evidence, which cannot be truthfully produced: Cloudflare arbitrary-recipient entitlement is unverified, and Billing API verification is unavailable. It is not enabled and no evidence was invented.

### Non-expiring signing keys and signing KEK — deployed, key 3 live

**Owner decision, 11 November 2026 (option C).** A new signing key's last valid day is the sentinel `2147483647` (largest PostgreSQL integer; the Functions read it as u32 without arithmetic, so no Function or release change was needed). A key gets a real end day only when it is retired: rotation shortens the retiring key to its retirement shop day + 3 before publication; revocation shortens to UTC day + 3; activation keeps a UTC + 4 backstop. Destruction then follows its normal rule. Epoch bump stays the immediate emergency revocation. [Spec §5.5](../architecture/implementation-plan.md) and the [runtime README](../../deployment/m5-runtime/README.md#signing-wrapping-key-kek-custody) own the contract and procedure.

**PR323 (merge `92a189e1`, tree `9cf75d49`), deployed web-only at `19:21:46Z`.**
- Migration 56 lets `last_valid_day` only shrink (never below `first_valid_day`) on a pending, active, retiring or revoked key; every other identity field stays immutable.
- Signing KEK custody: a dedicated wrapping key `signing-20261111` (`INSIGNIA_SIGNING_WRAP_KEY_*`), held only by web. The worker, verifier and inspector never hold it. `INSIGNIA_SIGNING_UNWRAP_CREDENTIAL_KEYS=1` was set only for the rotation window and is now removed.
- Least privilege: web has `SELECT, INSERT` and column-scoped `UPDATE` on `signing_keys`; no `DELETE`, no `TRUNCATE`, no update of identity or public key. The worker still cannot read envelopes.
- Library re-wrap (`SigningKeyLifecycle.rewrap`) re-seals a seed under the current KEK, guarded by the expected old kid. No packaged CLI.
- Image `sha256:a16e4131…`; worker, verifier, inspector and Shopify version unchanged. A DB-only checkpoint (no configs, so no KEK) was restore-verified at `19:21:38Z` (schema 55, facts 8/7/2/7/10, migration 56 dry run); its encrypted copies were disposed at `19:30:31Z`.

**Rotation to key 3, rewrite-dev, `19:26Z`.** Owner flow from `/admin/signing` (one arming, owner-result `PROVISIONED`, all twelve journal operations settled including `SCHEDULE_RETIREMENT`).
- DB readback: key 3 active, days 20768–2147483647, envelope kid `signing-20261111`; key 2 retiring, days 20766–20771 (shortened); key 1 retiring 20736–20767 (destroyable from UTC day 20769). Epoch 0 unchanged.
- Web disarmed at `19:27:30Z` (no owner mounts, no unwrap flag), healthy.
- Storefront: Designer quoted M×1 at $17.45; Add to cart gave one `_insignia_line_v3` (259 chars) with key ID 3, valid through 20770, unit 1745; checkout showed $17.45 with no validation error. No order; cart emptied. Protected facts 8/7/2/7/10.
- **No routine rotation deadline remains.** Rotate only on leak, compromise or reinstall.

**Encryption review of private signing keys.**
- Seeds are sealed with AES-256-GCM, random 96-bit nonce, AAD binding shop, installation generation, authorization generation and key ID. A copied envelope cannot be replayed into another row or shop. Seeds are zeroed after use (Node's `KeyObject` copy lives until GC).
- Before this change the KEK was the shop-credential ring, which the worker also holds, and web could delete or rewrite any key row; full-environment checkpoints carried KEK and ciphertext under one recipient. All three are fixed above; checkpoints are now DB-only.
- Blast radius: database or backup alone gives ciphertext only; KEK alone gives nothing; worker compromise gives no seed; **web compromise gives every live seed** — respond with epoch bump, then rotation and KEK re-wrap. Losing the KEK only costs availability (keys are re-provisionable).
- Owner recommendations (not implemented): move signing into an HSM/KMS or a separate signer process; keep an owner-held offline copy of the signing KEK.

### Canonical host app.insigniacustomizer.com — released and deployed

**Owner decisions, 11 November 2026.**
- Insignia's canonical app host is `https://app.insigniacustomizer.com`.
- `insignia-app.optidigi.nl` was first kept as a fallback. A later owner decision the same day removed it entirely; see "Full move" below.
- The per-visitor limit reads a Cloudflare header, not Traefik trust. Traefik static configuration is unchanged.
- Insignia mail moves to `noreply@insigniacustomizer.com`.

**Cloudflare, owner-configured.** Zone `insigniacustomizer.com` (id `dff06e0e2d0b2edd2aa9fad51c91bd3a`, Free, SSL strict, Always Use HTTPS):
- `A app` record to the host, proxied.
- `http_request_late_transform` ruleset `a7cc761b…`, scoped to `http.host eq "app.insigniacustomizer.com"`, with two rules:
  - remove any client `X-Insignia-Client-Chain`;
  - set it to `http.request.headers["x-forwarded-for"][0]`, which is the XFF before Cloudflare appends its hop.
- At 11 November the zone had no other DNS records (no MX, SPF, DKIM or DMARC).

**Origin and TLS (PR315).**
- PR315 first made both Insignia routers match both hosts, keeping the Cloudflare-only `ipAllowList`, with one `tls.domains` entry per host. PR320 later removed the old host.
- Let's Encrypt issued `app.insigniacustomizer.com` through Cloudflare by HTTP-01 at `13:19:05Z`; it expires 9 Feb 2027. Cloudflare does not redirect `/.well-known/acme-challenge/`, so renewal uses the same path.
- Direct-origin requests get 403 on both hosts.

**Release (PR316, merge `e61a3a1d`, tree `798d8d6b`).**
- Inactive candidate `1203782746113/native-canonical-host-aa3b6166` was created once at `13:15Z`.
  - It came from the frozen `native-cart-line-v3-aa3b6166` staging, with only `shopify.app.toml` URLs changed.
  - Theme and Functions are byte-identical, including module ids.
  - Eight modules changed by host only. The five webhook subscription modules have new registrations because Shopify keys them by URI.
  - The binding has 35 versions and module hash `6599faf6…`.
- Phase B at `13:54:13Z`:
  - non-draining checkpoint restore-verified (schema 53, facts 8/7/2/7/10);
  - verifier, web and worker replaced with profile `native-canonical-host-aa3b6166` and `APP_URL` set to the new host (web `sha256:404afebb…`, worker `sha256:3b083cad…`, verifier `sha256:e8da2e53…`, manifest `2a8fb9d5…`);
  - inspector and schema unchanged;
  - exactly one `app release` (exit 0 at `13:54:19Z`).
- Independent readback at `13:54:26Z`: Active `1203782746113`, 35 versions, NEVER_RELEASE versions inactive, Active modules equal the binding.
- Fresh web collect and worker-role read matched record `31281065…` (version `1203782746113`, Functions `aa3b6166`).

**Native checks on rewrite-dev (default profile; cart emptied afterwards).**
- The embedded admin loads from `https://app.insigniacustomizer.com/admin/home`.
- All app-proxy requests arrived on the new host: config, session, artwork upload, proposal, acceptance and cart confirm.
- The Designer quoted XS×1 at $17.45 and Add to cart produced one `_insignia_line_v3` line at 1745.
  - The first Add failed with `UnexpectedFailure` in acceptance prepare (correlation `e33174ff…`, after all traced sub-steps succeeded).
  - The immediate retry succeeded with every stage passing. Cause later identified: the 60 s billing cache outlived the 30 s entitlement policy (fixed in PR319; see the quote "Unavailable" fix).
- App webhook subscriptions are on the new URIs, per the version readback.
- After `APP_URL` changed, the worker enrolled a new per-shop uninstall subscription on the new origin (registered `13:54:45Z`). The old-origin destination stays registered and valid.
- No order was placed; protected facts are unchanged.

**Per-visitor limit (decision B).** A temporary diagnostic logged only hash prefixes and entry counts.
- Every app-proxy request on the new host carried exactly one chain entry: the buyer's real egress address (IPv6; browser and host matched).
- A buyer-supplied `X-Forwarded-For` or `X-Insignia-Client-Chain` did not change it.
- `CF-Connecting-IP` is Shopify's proxy egress.
- PR317 implements the limit, deployed below:
  - last chain entry only; IPv6 counted by /64;
  - keyed HMAC, no address stored, rows deleted within an hour;
  - 20 new sessions per address per hour on top of the shop ceilings, failing open without a trusted address.

**Quote "Unavailable" fix (PR319, owner-confirmed root cause).**
- Cause: PR304's 60 s Partner subscription cache outlived the entitlement policy's `maxAgeMs` 30000. Proposals and acceptances 30–60 s after the last real Partner read projected a stale entitlement, which failed as `UnexpectedFailure`. This was also the earlier first-Add failure `e33174ff…`.
- Owner decision: `maxAgeMs` is 65000 (repo policy, Standard candidate and private web env).
- The cache never reuses a snapshot past `maxAgeMs − 5 s`.
- A stale or missing observation is now a retryable 503 with diagnostic class `EntitlementObservationUnavailable`. A recognized denial is unchanged.
- Live re-check after deploy:
  - Real Partner read at about `17:36:21Z`. Design 1 (XS) was added.
  - Design 2 (different position, S) ran its proposal at `17:37:05Z` (about 43 s later) and its acceptance at `17:37:15Z` (about 54 s later), both on the cached snapshot. Both priced at $17.45 and added.
  - The cart was emptied afterwards.

**Full move to app.insigniacustomizer.com (PR320).**
- Both routers serve only `Host(app.insigniacustomizer.com)`. `insignia-app.optidigi.nl` now returns 404 through Cloudflare and directly; the fallback is gone.
- The Active version `1203782746113` already uses only the new host, so no further Shopify release was needed.
- Migration 55 adds the terminal uninstall destination state `superseded`. It does not change the repair version.
  - Once the current-origin subscription is confirmed, enrollment deletes an earlier origin's per-shop uninstall subscription (`webhookSubscriptionDelete`) and supersedes it.
  - It does so only when Shopify confirms the deletion, and never for a destination that received a delivery.
- Rewrite-dev: the old-host destination was superseded at `17:33:16Z`. A read-only Admin API listing then showed one API-managed subscription (`APP_UNINSTALLED`) on `https://app.insigniacustomizer.com/api/webhooks/uninstall/…`. App-config webhooks are on the new host per the release readback.
- **VAT-verification store (`stitchs-vat-verification-20261004`), owner action:**
  - Its installation has no stored offline credential, so its old-host per-shop uninstall subscription (destination `247b526a…`, registered) can be neither read nor deleted.
  - Obtaining a credential would be a bootstrap on the protected `UNRESOLVED_NO_RETRY` installation, which is not authorized.
  - The app-level `app/uninstalled` subscription for every install points at the new host. The leftover per-shop subscription now targets a 404 host.
  - Owner choice: leave it, or authorize a one-time admin open of the app on that store (session-token exchange stores a credential) so the cleanup runs.

**Combined deploy, 11 November 2026 (main `add83af7`: PR317 + PR319 + PR320).**
- Images: web `sha256:9826b1f4…`, worker `sha256:e122bfd5…`, verifier `sha256:f3b0e8f1…` (manifest `76ec0060…`).
- A non-draining checkpoint was restore-verified (schema 53, facts 8/7/2/7/10, dry runs of migrations 54 and 55). Its encrypted copies were disposed at `17:37:54Z`.
- Migration 54 and its web grants, then migration 55, were applied through the guarded schema owner at `17:32:30Z`. Schema is now 55.
  - Web: `SELECT/INSERT/DELETE` and `UPDATE(window_at,issued)` on `buyer_visitor_admission`, with no `visitor_key` update and no worker access.
- Verifier, web and worker were replaced at `17:32:40Z`. The web composition changed only in image, the old-host labels, the policy `maxAgeMs` and the removed diagnostic env.
- Fresh web collect and worker-role reads matched record `843be8e0…` (version `1203782746113`).
- Checks: new host 200 through Cloudflare and 403 direct, old host 404, other sites unchanged, embedded admin loads from the new host. Protected facts are 8/7/2/7/10.

**Mail sender.**
- Code and both private email profiles use `noreply@insigniacustomizer.com` and the new `appOrigin`. Customer email stays disabled.
- The owner onboarded `insigniacustomizer.com` for Cloudflare Email Sending: `cf-bounce` MX/SPF/DKIM and `_dmarc` `p=reject`.
- **One owner-approved transport test: approved and consumed, `2026-11-11T16:58:28Z`.**
  - From `noreply@insigniacustomizer.com` to `admin@optidigi.nl`, through the PR317 adapter and the development profile.
  - Cloudflare HTTP 200, `queued`, message id `<dl7W6JAZX8PxXh4ZbwdNMhsKng18ZZ3dwPOF@insigniacustomizer.com>`.
  - The owner confirmed on 11 November 2026 that it arrived in the `admin@optidigi.nl` inbox, not in spam. Received authentication headers (SPF/DKIM/DMARC verdicts) were not inspected. Do not repeat without a new approval.

**Still on optidigi.nl, and why.**
- The operator-alert relay `insignia-alerts@optidigi.nl` → `admin@optidigi.nl`: owner decision to keep.
- The development recipient `admin@optidigi.nl`.
- The shared Traefik ACME contact: not Insignia-owned.
- Historical evidence (for example `deployment/m5-019`, kept as a retained record; nothing executes it).

**Legacy generic app removed, 11 November 2026 (owner decision).** The separate legacy `insignia.optidigi.nl` stack (`insignia-app` and `insignia-postgres`, `/srv/saas/infra/stacks/insignia`) had its own Shopify app key and no installations; its one stored shop token returned 401. It had 0 orders, and in 14 days its only traffic was a health monitor, its own cleanup cron and bot scans.
- A final `pg_dump` was restore-verified in a throwaway container: 1 product config, 1 shop, 11 logos.
- The dump, compose file, private env and pre-change crontab are kept privately (0600) under `~/.local/share/insignia/legacy-generic-removal-20261111/` on prod.
- Removed: its two crontab lines, both containers, the `insignia_internal` network and its data directory. The compose file was renamed `compose.yaml.removed-20261111` so it cannot be restarted by accident. `insignia.optidigi.nl` now returns 404.
- Kept: the shared image `ghcr.io/optidigi/insignia-app:latest`, which the Superfunny and Custom apps also use.
- Untouched (owner requirement): the Stitchs, Superfunny and Custom legacy stacks, including their cron jobs and secrets. All three returned 200 afterwards.
- The external uptime monitor that probed `insignia.optidigi.nl/api/health` is the owner's Cloudflare custom status Worker; per the owner it detects the removed service by itself and needs no change.
- The VAT store's leftover per-shop uninstall subscription (above). Owner decision 11 November 2026: leave it; it is harmless.

**Future cloudflared tunnel.** If the origin moves behind a tunnel, replace the `ipAllowList` with tunnel-only access (no public port). The zone transform rule keeps working, because it runs at Cloudflare's edge.

### Combined cart-line v3 release — complete

- **Owner grant, 10–11 November 2026:** ship PRs 298–306 as one new rewrite-dev app version, release it as the single v3 cutover (no dual-format Function), then deploy the matching runtime to `prod`. The grant explicitly authorized changing Function bytes, behavior and input queries for this release. It granted no new scopes, markets, database reset or rollout.
- Phase A created inactive candidate `1202999689217/native-cart-line-v3-aa3b6166` once (CLI 4.9.4, Node 24.21.0) from merge `aa3b6166eb2b4679f27e1b7f128d914137ba8412`; PR307 bound it. [Runtime README](../../deployment/m5-runtime/README.md#cart-line-v3-candidate-development-transition) has the pins and operator changes. Phase A packet: `~/.local/share/insignia/recovery-release-20261110/cart-line-v3-42932707400-1`.
- Phase B (migration 53, web grant, runtime deployment, release, fresh admission) completed on 11 November 2026; the result is recorded below. Open carts that still held v2 carriers now fail at checkout and need Designer repair, as the owner accepted.

### Cart-line v3 — deployed and natively verified

- **Owner decisions, 10 November 2026** ([wire contract](../architecture/CART-LINE-V3.md), [spec §5](../architecture/implementation-plan.md#5-signed-cart-authorization-protocol)): one Ed25519 signature per acceptance/renewal over a header committing to a Merkle root of per-line records; every customized cart line carries its own `_insignia_line_v3`; quantity and totals unsigned; one acceptance per cart; ordered quantities are the truth. Every guarantee given up is listed as owner-accepted in the wire contract.
- **Single cutover:** the server issues v3 only and both Functions accept v3 only (a leftover v2 line is an invalid carrier and goes to review). There is no protocol flag and no dual-format Function. Reconciliation keeps v2 verification permanently.
- **Measured (pinned function-runner 9.2.2, local build):** 32 signed + 168 ordinary lines take 8.43M instructions (Transform) and 8.34M (Validation). Small carts take 2.68–2.77M, and 10 signed + 190 ordinary take 6.78M / 7.04M. Worst-case input is 97 kB and the Transform output bound is 11,312 B. Stack peak remains unmeasured. Native qualification (theme quantity change, removed size, altered carrier, test order binding the ordered quantity, renewal after a quantity edit) is outstanding; no checkout or order was placed in this transition.

- **Native verification, 11 November 2026 (rewrite-dev storefront, default profile cart emptied afterwards):**
  - Theme quantity change: XS 1→4 kept $17.45 each, with no review notice. Removing the M line kept XS priced. Checkout accepted $69.80.
  - Altering one character of a `_insignia_line_v3` carrier dropped the line to the $9.95 base price, and checkout blocked with the localized review message. Restoring the carrier restored $17.45.
  - Lines carry only `_insignia_line_v3` (302 characters for a 2-line set), and there is no cart attribute.
  - **Owner-approved test order** (standing approval for rewrite-dev test-gateway orders, 11 November 2026). Quote XS×1 + M×1; native XS→3 and M removed. Bogus Gateway, confirmation `4MR0PUDG8`, total 6035 (5235 + 800 test shipping), about `2026-11-11T09:35:27Z`. Read-only readback: `is_test`, USD, bound to its quote, one line at index 0 with quantity **3** at unit 1745, paid. **Protected facts are now orders 8, paid 7, refunds 2, bindings 7, lines 10**; future preflights must expect these counts.
  - Not exercised natively: renewal after expiry (needs shop-local day D+3) and per-visitor limits under load.

### Buyer acceptance performance — deployed and natively measured

- **Owner decisions, 10 November 2026** ([spec §8.4](../architecture/implementation-plan.md#84-acceptance-and-cart-application)): proposals skip release/Function verification; acceptance reads providers once before the shop lock and re-checks only stored facts inside it (2 s `lock_timeout`, retryable 503); the 30-second release freshness is unchanged and kept warm by a bounded background refresh; Partner subscription reads are reused for 60 s; `GET /v1/config` reuses provider reads for 30 s with a per-shop miss budget and `Server-Timing`.
- Buyer DB pool raised from 4 to 10 connections. Deployed headroom: `max_connections` 100 (3 superuser-reserved) on the dedicated rewrite PostgreSQL; web pool ceilings total about 36 (runtime 10, admin 10, buyer 10, purchase 4, notification 2), worker 4, plus inspector and verifier.
- Local model with research-measured provider latencies: proposal 5.77 s → 0.65 s; acceptance within 30 s 2.56 s → 1.13 s; acceptance after 30 s 7.06 s → 1.08 s with a warm record (4.95 s if it must still collect). Native measurement on the deployed artifact is outstanding; client-side config/draft serialization is unchanged.
- Background refresh cost: at most one collection (about eight provider reads and one `trusted_release_records` row) per shop per 25 s while active, at most twelve per isolated proposal (five-minute activity window, owner decision 11 November 2026; was six at two minutes), none when idle; per web process.
- **Cloudflare-only origin — deployed, 11 November 2026 (owner decision A).** Both Insignia routers use the route-level `insignia-cloudflare-origin` `ipAllowList` of Cloudflare's published ranges, pinned in [cloudflare-ips.json](../../deployment/m5-019r/cloudflare-ips.json), with the refresh procedure in the [runtime README](../../deployment/m5-runtime/README.md#cloudflare-only-origin). Other sites, the shared entrypoint and Traefik's static configuration are unchanged. Before the change, 72 hours of logs showed every Insignia request (12,479) arriving from Cloudflare ranges.
- **Per-visitor session limit (owner decision B):** the global Traefik trust plan was superseded by a Cloudflare header. See [Canonical host](#canonical-host-appinsigniacustomizercom--released-and-deployed).

- **Native measurement, 11 November 2026:**
  - Quantities → Review: the proposal took 0.70 s, with config at 0.27 s (cached) and the draft save running alongside it. Before, it took 5.5–5.8 s.
  - Add to cart → cart page: 2.4 s, against 4.0 s before (8.8 s after a pause).
  - A Designer left open for 336 s kept showing the price with Add enabled. One click re-proposed and reached the cart in 5.8 s, including a synchronous release collection, because the background refresh then stopped 2 minutes after the last proposal. On 11 November 2026 the owner extended that window to 5 minutes; the 30-second freshness is unchanged.

### Deployed source and runtime

- **Web-only update, 11 November 2026.** The web container now runs main merge `721bc6b698fe50a9955baa3b4b2815ac43794a14`, tree `dac2a72c324535145252a3c675bf5262a3161bd8`. That is PR312 (5-minute release refresh) plus PR313 (Cloudflare-only origin labels). [Runtime 43011684092](https://github.com/Optidigi/insignia/actions/runs/43011684092) and [foundation 43011684081](https://github.com/Optidigi/insignia/actions/runs/43011684081) passed on attempt 1.
  - Web image: `sha256:e633bfcd1fc45c6c4079d2d1b975ebb642a66e7366d58de6eafd6f334f36ea6b` (config `sha256:f4df8c01a446953964a05fd54c82285f96bb9c9e088e4f8c3ce1bf6341b05d76`, archive `06a7d450…`). It replaced `b05f2c60…` at `2026-11-11T12:30:03Z` (`--no-deps`).
  - Since `b7177076`, only web source changed, so the worker, verifier, inspector, schema 53 and release profile `native-cart-line-v3-aa3b6166` are unchanged. The private web composition changed only in its image and the three origin-lock labels.
  - Before the switch, a fresh encrypted checkpoint was restore-verified in isolated PostgreSQL at `12:29:50Z`: schema 53, protected facts 8/7/2/7/10. Its encrypted copies were disposed at `12:33:31Z`.
  - Fresh web release-record read: record `9e0c1df4-6829-43cb-814d-11921bd0cd3c`, version `1202999689217`, Functions `aa3b6166`, observed `12:30:49.853Z`, read-only runtime role. This is not purchase admission.
  - Native check on the rewrite-dev storefront (default profile; the cart was emptied afterwards): config, artwork upload, quote and add to cart all went through the app proxy. The cart line was XS×1 at $17.45 with one `_insignia_line_v3` carrier.
  - Direct-origin requests to `/live`, `/admin/products` and both webhook routes get Traefik `403 Forbidden`. Through Cloudflare they still reach the app.
  - All non-Insignia containers, Traefik and its dynamic configuration are unchanged.
  - Custody: `/home/serveradmin/.local/share/insignia/recovery-release-20261110/origin-lock-20261111-1/deployment-receipt.json`. Rollback configuration `web.prev.private.json` is there too, and the prior image is still loaded.
- The cart-line v3 transition deployed main merge `b71770763a4189f43bd72c580442d9ff9d901b22`; the worker, verifier and inspector still run it, tree `b2d631706dcd3ae05afb2b63a1bd1868e523bb46` (PR307 binding `native-cart-line-v3-aa3b6166`, PR308 publication-activation calendar fix). Application source PRs 298–306 are in `aa3b6166eb2b4679f27e1b7f128d914137ba8412`. [Runtime 42943190043](https://github.com/Optidigi/insignia/actions/runs/42943190043) passed on attempt 1, durable core 42943189954 on attempt 1, and [foundation 42943190212](https://github.com/Optidigi/insignia/actions/runs/42943190212) on attempt 2. All 14 foundation theme assets equal the Phase A staging and Phase A foundation bytes, all 101 present manifest entries matched, and the foundation Function wasm equals the candidate's. Later status-only commits change this mutable handoff file and need no image build.
- Foundation attempt 1 failed one test, `reconcile-v3.test.ts › rejects stored history differs`. That is a test fixture defect, not a product failure: the tamper replaces the carrier's last character with `A`, and with a fresh random key the carrier already ends in `A` in about 1 of 64 runs, so nothing is tampered and reconciliation correctly accepts. Local reproduction failed 7 of 128 runs, every one with an unchanged carrier ending in `A`; every changed carrier returned `AUTHORIZATION_HISTORY_MISMATCH`. Fixed by PR310: the tamper now always changes the carrier.
- Shopify Active is `1202999689217/native-cart-line-v3-aa3b6166` after exactly one `app release` dispatch (intent `2026-11-11T02:26:23.7Z`, exit 0 at `02:26:28Z`; CLI 4.9.4, Node 24.21.0, Phase A frozen staging). Independent SDK readback at `2026-11-11T02:26:33.761Z` showed the exact 34-version inventory with only that version active. All three NEVER_RELEASE versions remain inactive, and both candidate and Active modules equal the committed 14-module baseline. Active Functions: transform module `826a9059-f6c2-49ff-861a-7155b1f848fb` (183604 wasm bytes, query `02ab5bce…`), validation module `076bfef2-e925-4f68-bcb8-7398df7305c6` (181608 wasm bytes, query `5867e61f…`). Prior Active was `1202733449217/native-functions-renew-8fffc9de`.
- At the v3 transition the web image was `sha256:b05f2c60be0e541dcf4f1283e620bc4b3d22f116039d10277efdf1f385e7b44e` (config `sha256:eb462cdf9b75b12734bbfb99cb0452858c41d998b4b77e50622870d2cd308b70`); it was replaced on 11 November 2026 (see the web-only update above) and remains loaded for rollback. Running worker image: `sha256:885b6b79e99bffb0dbb1e0d493f05fc433cb3d13a18d94a004fa7b6f801e853a` (config `sha256:67cf177fad99a1bd393a7e1083235b7385cfe23c22e8ec6b3a78fbeb30e97f29`). Running verifier image: `sha256:2b3b61a0fe4e62b02ec4860e33b7f14d1d384f0df8dda957232bd69cc311b8ea` (config `sha256:69f2199ae52e73b5a8b53b82874d2142dfd9cdc011d572e9669e092348f3a80b`). Verifier code-manifest SHA256: `fc211dcbe0f17c4d9cf0800f72ce54bf56a192a0b3ed05592f1265819cd23a53`, also checked offline in the loaded image. Archive, OCI blob, config, layer and loaded identities qualified. The configuration change was only image identities, `INSIGNIA_RELEASE_PROFILE`/verifier profile and verifier manifest; `INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON` is unchanged (legacy `8d93a086…`/`5baff05a…` fields kept for the rollback image). Web and worker are healthy, and the verifier runs with exclusive socket custody. Mounts, networks, security, restart settings, private custody and unrelated containers are unchanged. The database remains on its pinned PostgreSQL 18.6 image.
- Switch order: drained checkpoint (`02:25:21Z`), isolated restore-verify, migration 53 and grant (`02:25:38Z`), consumers with the new configuration (`02:25:44Z`), inspector handover (`02:26:09–18Z`), then the single release (`02:26:28Z`). Consumers were stopped for about 23 seconds. In the roughly 44-second window before the release, readiness was observed fail-closed: no fresh release record existed for the new profile while `1202733449217` was still Active. After release, both owned Functions read `present` against the queries derived from the fresh record (`02ab5bce…`/`5867e61f…`); Admin still returns `inputQuery: null`, so the release record is the query gate.
- The host inspector moved from `7986475fd75b4ae8af58ddaa4337de93ac7d79aa` to `~/insignia-artwork-releases/b2d631706dcd3ae05afb2b63a1bd1868e523bb46/` (tar `c60c6251afb9193c487a1983b984fa5aeaa1670ae05d3ababbf7d7d3258ba76c`, manifest `c4f7e59c179110527865da57f0e71e21e903593f49978fcae2dda5434b94119f`, unit `43a95b7006c315c95d444c19cad4e3827a7baa9bcb200209d75b810a47cceb83`). The artifact was not byte-identical: 40 of 9554 files differ (application/cart-authorization/database/shopify dist, worker purchase-admission, package metadata) and none under `worker/dist/artwork`, so the README handover ran. Bytes passed verify-only, the unit delta is only the release path and digest, and the sandbox probe passed (no network, secret file invisible, read-only code, zero capabilities, CPU 8:9, memory/hang jobs killed). The drained handover had zero artwork claims; the old process exited and its socket was absent before start. Readiness returned 200, representative SVG/PNG/JPEG jobs returned exact types, dimensions and digests, and a graceful stop/restart repeated that pass with no storage writes or provider calls. The readiness directory inode and private configuration are unchanged. The old artifact remains for rollback.
- Schema is now 53 and equals all 53 repository migrations: migration `20261110000100_buyer_visitor_limits.sql` and the single web grant `UPDATE(expires_at)` on `public.buyer_sessions` ran in one guarded schema-owner transaction while consumers were drained, after an isolated dry run on the restored checkpoint (51 real session rows; a NULL `grant_expires_at` still rejects an expiry change, so the previous writer stays compatible). Row-level readback: only `buyer_sessions.expires_at` gained `insignia_runtime=w`; the runtime has no full-table UPDATE and the worker no `expires_at` UPDATE; roles, memberships and schema ACLs are unchanged. **New expected ACL digests** (readback aggregate): columns `f0468d2c3dbb5b9b4e78cca2a4ef6e16`, relations `3ffeb862258b37d3fa4a72cc905cc2f6` (only the new index row, empty ACL), functions `699ef08311ab57a35f7789e6778add89` (no ACL or secdef change; the aggregate orders by a constant, so the rewritten `buyer_session_identity()` row moved it), memberships `bcf2a8cbfcabad0f97b058fd9aa4c3c6`, schemas `985cd5294370e1294156e54aad39bb83`. Key 1 remains retiring for 20736–20767 and key 2 active for 20766–20797. Protected facts were **orders 7, paid 6, refunds 2, bindings 6, lines 9** before and after, with identical row digests. Pending application 1 and declined markers 0 are preserved. No rollback or authority/history reset occurred.
- A fresh encrypted development checkpoint restored in isolated PostgreSQL before the migration, with matching schema and protected facts; config hashes were verified in memory. This is not complete production recovery. Seven temporary transition payloads/copies (1,478,979 bytes) were disposed at `2026-11-11T02:27:36Z` remotely and `02:27:38Z` locally, before their 04:25:21 UTC deadline. Permanent runtime configuration, recovery key/certificate, verifier auth/journals and the image archives remain.
- Fresh web and quiesced restricted worker-role reads matched record `2dde24ff-f732-4251-97f3-11694a33fb56` (version `1202999689217`, Functions source `aa3b6166`), observed `2026-11-11T02:26:46.600Z` and expired `2026-11-11T02:27:14.403Z`. This finite proof is historical; it is not ongoing authority or running-worker purchase admission. Every future purchase still requires the live independent checks.

Operational proof custody: `/home/serveradmin/.local/share/insignia/recovery-release-20261110/cart-line-v3-final-42943190043-1`, including `deployment-receipt.json` and finite image/readback/migration/inspector/disposal receipts. Phase A candidate custody remains in `cart-line-v3-42932707400-1`; the previous transition is in `functions-renew-final-42893217931-1`. These are locators for an authorized operator, not fresh-clone prerequisites or new execution authority. The host has no mutable `/home/serveradmin/insignia-current` checkout; services use immutable images/packages. Repository handoff criteria are main tracking origin/main, matching HEADs and an empty working-tree status. At session start, verify those actual values and compare any commits after the deployed source. Documentation metadata is not application-code drift.

### Previous transition: Functions renew (10 November 2026)

- PR293/PR294 were released as `1202733449217/native-functions-renew-8fffc9de` (one dispatch at `2026-11-10T20:29:29Z`) with the matching runtime; packet `functions-renew-final-42893217931-1`.
- Native acceptance after that release (rewrite-dev storefront, cart token preserved and emptied afterwards): a leftover `_insignia_quote_v2` with only an ordinary polo checked out at $11.95; a designed cart changed outside the theme showed the localized review message at checkout and Review only on the cart page. Expired-offer renewal and the currency/Market notice were not exercised natively. These observations were on v2 carriers and predate the v3 cutover.
- **Owner-approved test order, 10 November 2026:** one test-gateway order (designed tee XS ×1, $17.45 plus $8.00 test shipping, Bogus Gateway, confirmation `WI0QU8QDF`, about `2026-11-10T20:49:50Z`), read back `is_test`, USD, total 2545, bound to its quote. It set the protected-fact baseline above. This approval is consumed and is not reusable.

### Continuing limits and custody

- The deployed source takes expected Function query fingerprints from the trusted release record and ignores the legacy query fields in `INSIGNIA_M7_EXPECTED_FUNCTIONS_JSON`. The functions-renew rollback image still requires them, so they stay until rollback to a pre-PR298 image is retired; then reduce the value to `appKey` only ([runtime README](../../deployment/m5-runtime/README.md#expected-function-configuration)). Rolling back would also need the prior app version re-released and a qualified v2/v3 cart decision; neither is authorized.
- Q1 terminal-decline recovery is integrated. Unavailable, lost and postcommit acknowledgements retain exact operation identity. With schema52 terminal markers, use compatible recovery/fix-forward; schema51 or old acceptance writers are not a valid rollback. The original same-tab cart report remains unattributed; its time/browser/error ID is unavailable and must not be requested again or assigned a shared cause without evidence.
- Development key 3 is active and non-expiring and signs only through the signer. Keys 1 and 2 have no private half: key 2 verifies through shop day 20771, and key 1 is past its window. Both are destroyed by the worker's daily job. Epoch 0 is unchanged. No rotation is scheduled or due. [Key 2 rotation receipt](evidence/technical-merchant-completion/native-signing-rotation-development-2026-11-09.json).
- Native Copy discovery/review and Cancel/scrim removal with pointer reopening passed on the earlier startup artifact. Fields not displayed, precise chooser timing, busy-copy and native early-aftershow are not qualified by that result. QA009 early-aftershow/leave-resume and uncancellable late-response limits remain scoped in [history](history-2026-11-09-precutover.md). New close/upload behavior is deployed and covered by built-UI/CI checks; native observation on this exact artifact remains unqualified.
- Retention reconciliation recorded ten expired capture paths disposed after 388 guards, four minimal projections retained, 363 operation records and five metadata inventories unchanged. Four local auth files remain held behind exact process-read access. Pathname absence does not prove physical erasure. Nov9 checkpoint payload was disposed before its deadline; Nov6 custody is not a fresh verified backup. Preserve active configurations, permanent inspector/verifier custody and minimal unresolved authority.
- Customer artwork email runs on rewrite-dev in development mode only: recipient fixed to `admin@optidigi.nl`, no backfill. Received authentication and delivery are qualified (see above). Customer mode for real buyers stays disabled. Owner visual acceptance, native EUR and complete off-host/object recovery remain separate.

[Frontend review links](../../frontend/README.md#native-development-review) identify the retained fixtures. [Integration history](history-2026-11-10-integration.md) records the combined-source result. [History through 8 November](history-through-2026-11-08.md) and [9 November preparation history](history-2026-11-09-precutover.md) retain original observations and authority context; they are not current commands.

## Owner/operator checklist

Earlier selected-UI transfer and qualification results are in [delivery history](history-through-2026-11-08.md#selected-admin-test-transfer). Their synthetic/local limits remain; owner visual acceptance and production qualification are separate.

This checklist retains outstanding owner/operator obligations from their dated source observations; active engineering work is above. The responsible-party columns identify missing resources, human actions or production allocations. Source links retain exact grants/observations; consumed allocations are not reusable. Private access uses existing verified SSH/custody or an owner-approved private credential channel, never chat/Git secrets.

| Item / status | Responsible party and exact next action | Resource, prerequisite and evidence needed to close |
| --- | --- | --- |
| Merchant UI — owner-unaccepted | **UI/integration engineer:** support review of the deployed candidate and any explicitly allocated remaining native-write qualification; **owner:** final judgment on wide/narrow screens and meaningful state behavior. | Rewrite-dev → insignia-1. Use spec inventory and local preview; native reads require rechecked access. Source/type/rendered controls, reviewed real screens and explicit owner acceptance; tags/HTTP200/canvas counts alone do not close it. |
| Selected Designer visual fidelity — owner-unaccepted | **Agent:** qualify the selected PR223 Designer on wide/narrow native storefronts, including retained production choices, geometry and artwork/review state. **Owner:** accept the resulting native UI. | The latest §15 instruction selects the new UI for every customer flow. PR223 and the retained selected components/reducers are the current presentation reference. The older S24 legacy-modal asset is historical context, not a prerequisite or fallback for this selected integration. Local browser proofs do not establish native visual acceptance. |
| Automatic customer artwork email — enabled on rewrite-dev in development mode (admin recipient only) | **Agent:** keep customer mode disabled until real arbitrary-recipient provider evidence exists. **Owner:** decide when to qualify Cloudflare arbitrary-recipient sending (entitlement evidence) for real buyer addresses. | Received authentication/delivery qualified from owner-supplied headers for `<lubIW02KieKU8MqVGX0zxlsoqHosdDYpQhoH@insigniacustomizer.com>`: SPF, aligned DKIM, DMARC and compauth pass; Inbox, SCL 1. Development-mode runtime enabled `23:45:02Z` with a no-backfill cut-off. The earlier two PENDING notices are untouched. Test order #1009 sent `<QCD5JF4Q5NbsESM4S2o1Z8Q2TDxLCG3EPSSN@insigniacustomizer.com>` to `admin@optidigi.nl` only. Customer mode, real-buyer recipients and backfill are not enabled. |
| Genuine uninstall/privacy — unresolved | **Owner/native operator:** reconcile the original VAT dispatch through actual provider state and genuine generation-bound callback evidence; obtain a new concrete allocation only for genuinely new effects. **Agent:** continue offline qualification and preserve the existing decision. | VAT installation `998524223812`, generation1, original intent `2026-10-18T22:19:55.728Z`: **UNRESOLVED_NO_RETRY**. No retry/reinstall/fabricated callback; protect rewrite-dev, receiver/worker and minimal immutable authority. Close with actual settlement plus qualified erasure/reinstall fencing, not failed calls. [Record](evidence/technical-merchant-completion/NATIVE.json), [lifecycle runbook](../../deployment/lifecycle/README.md). |
| Production storage/credentials — owner-held cutover | **Agent:** prepare exact current consumer/rollback inventory and use already-qualified isolated reconnect seams. **Owner/operator:** provide/allocate scoped production storage and credentials through private custody, then perform the identified bounded cutover. | Private `insignia-public` target; web/worker/inspector/verifier/backup/monitor/recovery consumers, existing wrapping/signing/offline credentials and retained-key dependencies. Local schema45 SCRAM rotation/drain/reconnect/rollback passed; actual native transition has not. Close with new-role/profile readback, old-credential rejection, full consumer readiness and unchanged records/permissions. [Runbook](../../deployment/m5-runtime/README.md#credential-rotation-procedure). |
| Complete backup/recovery — unqualified | **Owner/operator:** allocate source/off-host credentials, recipient certificate and separate recovery-key custody; install daily encrypted backup/replication and perform isolated complete loss recovery. **Agent:** prepare/review the runbook and rehearse safe boundaries locally. | Current database and private artwork/preview objects, seven-day maximum archive retention capped by existing promises. Close with actual off-host DB+object restore, erasure/expiry replay before exposure, measured **RPO24h/RTO4h**, rollback and signed-off recovery ownership. Local/DB-only results do not close it. [Backup runbook](../../deployment/backup/README.md). |
| Monitoring/email authentication — unqualified installation | **Owner/operator:** allocate/install the scoped producer/monitor and private relay configuration, verify outage/recovery wiring, obtain original receiver authentication verdicts. **Agent:** prepare qualified packages and checks. | Availability/backup/stalled-processing/overdue-deletion alerts to `admin@optidigi.nl`. Four bounded drill deliveries were confirmed; **do not resend** that consumed drill. Close with installed monitoring and receiver SPF/DKIM/DMARC evidence. [Alert record](evidence/technical-merchant-completion/NATIVE.json), [alerts runbook](../../deployment/alerts/README.md). |
| Native/commercial eligibility and release envelope — partial | **Owner + release engineer:** qualify applicable real $49.99/30-day contract/invoice/trial-to-paid and distribution/public-app settings, representative merchant/market/currency eligibility and supported capacity/enforcement on exact release artifacts under concrete native allocations. | Current positive journey is bounded USD/US development use; zero-dollar selection/cancel/reauthorization budgets are consumed. EUR/GBP or other contexts are not enabled/advertised by this evidence. Preserve exact money, ordinary supported discounts, OptionA residual, Function budgets and independent proof. Close the applicable spec gates, including artifact-specific stack/resource justification, without replaying deferred tier/FX/Plus/usage matrices. [Billing record](evidence/lean-v1/native-billing-lifecycle-2026-10-17.json). |
| Fixture/test-gateway disposition — bounded USD test order complete; retain review fixture | **Native operator:** read current owned fixture and gateway/test settings, compare original baseline/consumed allocation, prepare exact cleanup disposition; act only within a valid specific grant. | Owned product `10519322493211`, variant `54211066986779`, marker `insignia-m5-acceptance-1f443da8-75c4-44d1-99be-27c397e10c26`, retained test orders/purchase history. Preserve the fixture needed by current UI and all financial/history facts. Preserve the original fixture and the separately allocated demo product10585669959963. Its publication, paid native test order#1005, original artwork and current native cart handoff are qualified above. No automatic archive, change to existing stock, gateway toggle or reuse of a consumed payment budget. The new one-order allocation is consumed; no second checkout, gateway change or history deletion is authorized. Close with exact settings readback and retained-history/cleanup evidence. [Journey](evidence/lean-v1/native-lean-purchase-original-2026-10-17.json). |
| Runtime promotion/restart/rollback — production gap | **Agent:** prepare a minimal reproducible deployment/promotion plan and compatible immutable artifact inventory. **Owner/operator:** allocate final production effects and durable image/archive custody, qualify full restart/recovery. | The 19October audit observed verifier Docker restart policy `no` and no matching service unit. That historical observation does not establish current restart configuration; full reboot recovery remains unqualified. CI image export retention is three days. Preserve active dated mount/configuration paths until deliberately migrated; no automatic volume removal or broad host reconfiguration. Close with durable exact artifacts, full-role startup/readiness/restart and bounded rollback evidence. |
| Rollout — not approved | **Owner:** authorize controlled merchant rollout only after applicable checklist/spec gates close; **agent/operator:** verify exact source/artifact/configuration/installation envelope before allocated effects. | Production rollout remains unallocated. The separately approved §16 bounded development fixture and app/theme updates continue under their exact limits; they do not authorize new scopes, real charges or merchant rollout. Native smoke and internal review are not rollout approval. |

### Time-bound retention and private custody

**Past cutoff:20October2026 at00:00UTC** for explicitly timed private captures, safety snapshots and retained cleanup-operation copies. The exact deploy217 dump and two redundant deploy219 captures were disposed after their original deadlines. The [dump disposal receipt](evidence/technical-merchant-completion/development-expired-dump-disposal-2026-11-09.json) proves pathname absence and protected-configuration identity, not physical erasure. Later reconciliation recorded ten expired paths disposed and four minimal projections retained, with 363 operation records and five metadata inventories unchanged. Four auth files remain held behind exact process-reference access. Further disposal is not scheduled. Reconcile remaining overdue custody against original manifests and active references, preserving sole minimal unresolved authority. A handoff extends no deadline and does not convert an expired copy into a new recovery arrangement.

Some older source records say only `2026-10-20` without a time/zone; preserve that distinction and resolve them from their private manifest/source promise rather than inventing a timestamp. They do not extend the explicitly earlier midnight cutoffs. Native/private indexes: `~/.local/share/insignia/cleanup-20261019/{FINAL.json,RESTORE.md}` locally; VPS cleanup subdirectories `vps-r2`, `vps-r3`, `vps-cache`, `vps-cache-all`; current development handover/recovery packets `~/insignia-deploy217-20261019` and `~/insignia-deploy219-20261019`; current native capture index under the private `insignia-canonical-native-20261019` directory. Owner/operator must inspect the actual mounted paths and original manifests; these are locators, not deletion globs. Permanent verifier/inspector/configuration custody is distinct from disposable captures and does not extend any credential or personal-data expiry.

The original/design rows below were reconciled against the current rewrite fixture's database in a bounded **read-only** observation at `2026-10-19T16:43:47.586Z`; no database writes/provider calls or cleanup occurred. Current metadata is not new proof of physical object absence. All listed October deadlines have passed as of this update; this read-only review did not verify cleanup or extend any deadline. The **retention operator** verifies ordinary cleanup, original/derivative/quarantine absence and payload erasure as applicable, preserves financial facts, and records closure. If a row is already erased/deleted, verify that narrower outcome instead of repeating a mutation. Exact grant and worker-runbook boundaries remain binding.

| Record / last metadata | Exact original deadline (UTC) | Source |
| --- | --- | --- |
| Artwork `bf5e68d1-2213-44df-a3da-5d9c155b749b`, USABLE | `2026-10-21T17:11:18.009Z` | [Retention facts](evidence/m8-context-runtime/pr131-native-retention-facts-2026-10-14.json) |
| Artwork `a4d401a0-1f50-4431-a9f0-19db938246b3`, USABLE | `2026-10-21T17:29:58.544Z` | Same retention facts |
| Artwork `949a9e43-b3ee-4afc-b34d-f9a37ed099a3`, USABLE | `2026-10-21T18:30:57.729Z` | Same retention facts |
| Artwork `a02c0a73-dd68-4144-8030-11324da9675c`, USABLE | `2026-10-21T19:13:36.526Z` | Same retention facts |
| Artwork `7cb3c29b-a525-4e07-8631-bc8d8255f63d`, USABLE | `2026-10-21T19:53:52.426Z` | Same retention facts |
| Design purchase `e3a74311-4323-4ea0-ba1a-154a9e65cd49`, unerased | `2026-10-21T19:53:52.136Z` | [Replacement record](evidence/m8-context-runtime/pr140-native-merchant-replacement-2026-10-15.json) |
| Replacement artwork `b01c6980-c17d-409a-b1f9-4ae97ea0d0d8`, USABLE | `2026-10-22T00:53:38.690Z` | Same replacement record |
| Artwork `75cbd361-d5c4-4b59-99b4-dab45bff9da1`, USABLE | `2026-10-22T10:23:38.721Z` | [Artwork record](evidence/m8-context-runtime/pr156-native-artwork-quote-cart-2026-10-15.json) |
| Design purchase `61065563-ab4b-4261-9fe6-0ad5a3d8b58e`, unerased | `2026-10-22T10:23:38.381Z` | [Purchase record](evidence/m8-context-runtime/pr156-native-test-purchase-2026-10-15.json) |
| Artwork `f56527e5-480e-4509-be38-693c11d0ce97`, USABLE | `2026-10-24T10:07:20.522Z` | [Lean journey](evidence/lean-v1/native-lean-purchase-original-2026-10-17.json) |
| Design purchase `675e9dfa-d81a-4aa1-a17b-3faf98a97be8`, unerased | `2026-10-24T10:07:20.206Z` | Same Lean journey |
| Incomplete artwork `b92a171d-e23e-4bad-a174-81e1d5edcad7`, already DELETED | Tombstone retains `2026-10-22T00:31:47.899Z`; no new original-deletion task | [16October physical-absence closure](evidence/lean-v1/incomplete-asset-cleanup-2026-10-16.json) |

These specific development deadlines do not replace the product's absolute retention rules or authorize new manual deletion. Keep minimal immutable VAT/generation/economic authority while erasing disposable/private payloads under their actual policy. Gates and obligations close only with their required evidence, not a handover statement.
