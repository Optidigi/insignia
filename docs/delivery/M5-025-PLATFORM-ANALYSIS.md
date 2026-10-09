# M5-025 — uninstall authority analysis

**BLOCKED_PLATFORM_UNINSTALL_AUTHORITY.** This is a bounded failure to establish sufficient authority under the current evidence and offline resource envelope, not a claim that Shopify can never support a sound solution. Generation-bound shop-specific callbacks are the preferred candidate. Their platform delivery/lifecycle and coverage prerequisites remain unqualified; no production correction is selected or enabled from documentation alone.

## What is authenticated

[Shopify verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries) computes HMAC-SHA256 over raw body bytes with the app client secret. The pinned SDK15.0.0 `validateHmacFromRequestFactory` and production `verifyShopifyWebhook` agree. Current/previous secret overlap authenticates bytes but adds no event freshness. An unchanged body has an unchanged valid HMAC. HTTPS protects a delivery in transit; it does not make a separately submitted captured body/HMAC fresh.

| Surface | Authority and limitation |
|---|---|
| Raw body / HMAC | Authenticated bytes; no signed installation generation in the tested Shop payload. |
| Signed Shop ID | Stable provider Shop identity, checked against the durable tenant. It distinguishes shops, not installations of this app. |
| Signed `myshopify_domain` | Where present, checked against the routing domain; null is supported. A stable domain is not an installation nonce. |
| Topic/API version/name | Bounded unsigned routing claims. Another authenticated Shop-shaped message can be relabelled without breaking body HMAC. |
| Delivery ID | Unsigned deduplication key. Same-key metadata conflict rejects; a new key bypasses that protection. |
| Event ID | Unsigned event grouping; current database stores it but does not establish independent generation authority from it. |
| Trigger time | Unsigned timestamp currently compared to local activation/observation start. Changing it can defeat both uninstall binding and bootstrap fences. |
| Local receipt time | Trusted server observation of arrival, not proof of when uninstall occurred. Delayed delivery/replay can arrive after reinstall. |
| Local generation / external AppInstallation ID | Durable identity established by authenticated provider observations at bootstrap. Neither is authenticated by the legacy uninstall body. |
| Shop `updated_at` | Shop resource time, not an app-uninstall generation assertion; the published sample permits null. |

[The pinned 2026-07 webhook reference](https://shopify.dev/docs/api/webhooks/2026-07) supplies a Shop-shaped uninstall sample with stable Shop fields, nullable timestamps/domain and no AppInstallation ID. That sample and the local minimal synthetic body support the missing-field analysis; they do not prove that two particular native uninstalls emitted identical bytes. The indistinguishability argument must allow that case, as required by the authorization.

## Current irreversible path and indistinguishability

`handleShopifyWebhook` verifies bytes before durable `receive`; queue confirmation precedes HTTP200. `resolveLocked` verifies signed Shop identity, then uses unsigned `triggered_at` to bind the current generation. `processUninstall` locks the shop, invokes `deactivateCurrent`, revokes that generation's encrypted credentials and clears effective publication pointers in the same transaction as inbox completion. Worker retry/crash fences make that chosen effect durable; they cannot repair missing authority for choosing the generation.

The bootstrap's `assertNoObservedUninstall` also consults the unsigned trigger and claimed topic when fencing provider-observation/persistence overlap. Merely fixing worker selection would leave a replay capable of blocking first-auth/reinstall. This analysis does not rebuild or silently relax the accepted bootstrap contract.

Consider the same local generation2-active state and retained history in two worlds. In A, an adversary submits generation1's authenticated Shop bytes with new unsigned IDs and later claimed time. In B, Shopify delivers a genuine generation2 uninstall whose Shop bytes are identical, with those same metadata values. At the generic HTTP endpoint all observed authenticated inputs are identical. A deterministic decision cannot keep generation2 active in A and deactivate it in B. Randomization supplies no authority either. A body-hash tombstone rejects both; a timing window or receipt clock accepts both when presented within that window. This is the precise impossibility for the current input set, not a universal impossibility for independent channels.

The explicit real HTTP/PG18/production-worker negative assertion is retained as **RED**. Passing characterization means the failure is reproduced, never corrected security PASS. Changed topic/event/delivery/time and identical-body controls are separate from a genuine native uninstall experiment, which was not authorized or performed.

## Priority candidate: shop-specific generation-bound callbacks

The [2026-07 create mutation](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/webhookSubscriptionCreate) documents an HTTP `APP_UNINSTALLED` subscription. The [input](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/WebhookSubscriptionInput) accepts an HTTPS `uri`; it does not expose a generation field or custom signed header. Thus a unique, confidential callback capability in the destination path is a plausible independent context. This API shape is documented, not exact-public-app success evidence.

[Subscription management](https://shopify.dev/docs/apps/build/webhooks/subscribe) distinguishes app-wide configuration from shop-specific Admin subscriptions and warns of duplicate/conflicting deliveries during migration. Its after-auth registration pattern does not eliminate the interval before first authenticated app use or between persistence, registration and readback. Failing shop-specific subscriptions can be removed. The current reviewed TOML has no subscription blocks; that local fact does not prove remote subscription absence. Plan §6.5 still requires app-wide business/compliance subscriptions. No remote inventory, declarative change or registration occurred here.

The [topic enum](https://shopify.dev/docs/api/admin-graphql/2026-07/enums/WebhookSubscriptionTopic) includes `APP_UNINSTALLED` without listing an additional topic scope, unlike many neighboring entries. The create reference does not state a special public-app prohibition. This supports testing under unchanged existing grants; it is not proof of exact grant/permission acceptance. No new scope is proposed as a workaround.

[Uninstall documentation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/appUninstall) describes removal of app-associated subscriptions. [Troubleshooting](https://shopify.dev/docs/apps/build/webhooks/troubleshoot) describes finite retries and removal after persistent shop-specific failures. Neither page proves exact destination preservation, delayed delivery across reinstall, URI secrecy, registration atomicity or gap reconciliation for this exact app. The cleanup reference is current/latest, not a falsely pinned 2026-07 native observation.

A sound candidate must satisfy all of these requirements before implementation is accepted as complete:

1. Allocate a distinct unpredictable capability for one exact provider Shop/app/external installation/local generation/topic. A public generation number, UUID or unsigned query parameter alone is insufficient. Confirm subscription topic/URI through authenticated provider IO; bind that observation immutably to the generation.
2. Receipt admission persists the authenticated body and **capability-derived generation**, never a generation guessed from delivery headers. The uninstall route fixes the operation; contradictory headers cannot supply authority. Generic/declarative receipts remain durable but cannot independently authorize deactivation of a newer generation.
3. An old capability always resolves to its original generation. `deactivateCurrent(expectedGeneration)` remains the transaction fence. Retain only minimal non-secret mapping/audit needed for delayed delivery; do not reassign old tokens on reinstall, crash, restore or rotation.
4. Treat the callback URI as a bearer secret. Redact it from reverse-proxy/app/SDK traces, metrics, error bodies, database logs, query strings, dashboards and review packets. Store a hash for admission; any necessary registration recovery material needs an explicitly reviewed secret lifecycle, not repurposing the existing access/refresh-token store. Reusing client-secret-derived capabilities needs a separate rotation/overlap analysis. No new token store is implemented here.
5. A captured old body **and old callback** must not authorize a new generation. Leakage of the current callback capability is a separate credential compromise: body HMAC does not bind that URL or topic and cannot then provide freshness. This residual must be explicit, rather than claiming full replay resistance.
6. Cover uninstall before callback registration, lost registration acknowledgement, lost/removed subscription, uninstall during confirmation and reinstall during processing. Local SQL cannot make an external subscription transaction atomic. First-auth gating can prevent local commercial eligibility before qualification, but cannot guarantee an uninstall callback before registration. Existing generations need enrollment and an independent fallback; historical generic bodies cannot be retroactively upgraded.

These missing lifecycle facts and coverage authority prevent a complete demonstrably sound correction here. Callback capabilities are **NOT_DISPROVED / NOT_LIVE_QUALIFIED**, not an inferred platform PASS or an assertion of impossibility.

## Alternatives and genuine uninstall after revocation

| Alternative | What it can prove | Missing authority / trade-off |
|---|---|---|
| Exact authenticated `currentAppInstallation` read | Successful matching current identity proves the app was installed at that observation. Revalidate generation after IO. | Genuine uninstall can revoke access before receipt. Timeout,401,refresh failure,permission loss and provider error are not a signed installation-absence fact. A prior success may precede a genuine uninstall. Do not convert errors into deactivation. |
| Independent Partner install/uninstall history | A supported provider-owned timeline could remain available after shop credentials are revoked. | Exact access, completeness, ordering, lag and mapping to external installation are unproved; no Partner credential is supplied or invented. |
| Authenticated event bus | Provider/IAM-authenticated envelope might protect topic/event/time beyond the body. | Requires independently qualified ownership, metadata, completeness and generation mapping plus new infrastructure authority. Not a small approved pg-boss replacement. |
| Pending receipt + reconciliation | Admit before queue processing, retain a visible unresolved decision and retry only verification. | Pending indefinitely does not meet genuine-uninstall/erasure obligations. A bounded commercial hold can be attacker-induced denial and needs an explicit principal trade-off. No automatic timeout-to-deactivate or absence-on-error. |
| Body hash / event IDs / timestamp window | Bounds repeated identical admissions or known dedup keys. | Cannot distinguish legitimate identical later body from old replay; finite retention reopens replay. Not generation authority. |

The [Partner 2026-07 `RelationshipUninstalled`](https://shopify.dev/docs/api/partner/2026-07/objects/RelationshipUninstalled) exposes app,Shop and provider occurrence time, but no installation ID in that object. The [2026-07 events query](https://shopify.dev/docs/api/partner/2026-07/queries/events) documents paginated historical partner events. A complete independently authenticated install/uninstall timeline plus identity mapping is a candidate; the documented object alone cannot justify choosing a generation. Any proposed use must verify the supported query/access contract and never trust webhook time as its starting authority.

## Privacy and decision requested

[Shopify compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance) requires customer data request/redaction and shop redaction handling; it documents `shop/redact` after uninstall and warns that a manually triggered delivery does not test a subscription. The current M3 worker defers non-uninstall topics; durable admission/7-day payload metadata is not completed erasure. No native privacy, object deletion, restore-tombstone or delivery-deadline PASS is claimed. These existing obligations remain open at M10 and shipping acceptance; M5-025 grants no waiver.

Separate short-lived receipt evidence from installation deactivation and from irreversible customer/shop erasure. Replay protection cannot simply discard mandatory privacy receipts, retain raw bodies forever for dedup, or let pending reconciliation extend collection/deletion deadlines. Preserve minimal erasure tombstones independently of erasable payloads. Any fallback must handle absent Admin credentials and missing/out-of-order delivery; delayed generic metadata cannot choose which newer installation or newly collected data to erase.

Recommended principal decision: accept this bounded blocker evidence, retain the live worker/provisioning stop, and authorize a separate exact-app callback feasibility/coverage qualification if desired. That later authorization must name isolated installation resources, bounded registration/readback/uninstall/reinstall attempts, cleanup, confidential URI handling and independent gap-reconciliation evidence. If callback coverage cannot satisfy genuine-uninstall requirements, select and qualify an independent provider timeline/envelope or explicitly adjudicate a pending/reconciliation availability trade-off. This PR authorizes none of those operations and does not change the settled application architecture.
