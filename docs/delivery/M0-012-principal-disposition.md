# Principal disposition — effective-zero draft subscription

Issued: 28 September 2026. This is a scope/evidence decision, not a PR approval or a complete G8 pass.

## Accepted scope

The owner-relayed operator report says one draft-test subscription was approved for the new Insignia app and read twice through the Partner API. Its reported identifier is `gid://shopify/AppSubscription/38085427483`. The private draft has nominal USD 0.01 usage pricing; the approval and observed contract have effective zero recurring, per-unit and tier-flat amounts, without a trial or pending update. Retain that subscription, plan and meter. Do not recreate or activate them to match the historical synthetic adapter.

The principal has NOT read the server-local report or JSON, operated Shopify, or independently confirmed their values. M0-012 must import those actual local records and verify the live contract before any event. The report is accepted at its operator-reported scope; a new production billing guarantee is not inferred.

GitHub main was read at `e77e4e42f8858662889f9814eeb7d0c4ed3713ab`; PR #16 is the previously completed checkpoint. There is no new PR approval/merge in this disposition. The principal inspected the existing M0-010 parser and M0-011 send guard: they are deliberately narrower than the reported provider shape, require active prices, and expect two graduated tiers. Their rejection does not establish that the real draft subscription is invalid.

## Decisions for the bounded prototype

1. Treat `price.active` as price-record metadata, not the subscription's cancellation status. Shopify's Price/TieredPrice reference defines false as a price that is no longer the current product price. That does not establish WHY this test price is false. Preserve the boolean and its uncertainty; use fresh exact-app/shop activeSubscription results and their effective terms for this test.
2. Admit the recorded single-tier VOLUME test tariff through an explicit new-app, effective-zero test profile. Do not change merchant-facing pricing, commercial allowances or the old synthetic GRADUATED fixtures. Validate all actual tariff fields and the tested quantity coverage.
3. Permit a separate, opt-in immediate-use token policy for this experiment. A Bearer received directly through verified HTTPS from Shopify's documented token endpoint using this exact app's credentials may be used for one bounded event request despite omitted scope/expiry metadata. Missing metadata stays unknown; supplied contradictions reject. Retain the old strict token-client behavior. The new path must not accept a caller-pasted token as equivalent to trusted acquisition.
4. Use no cross-request token cache or JWT-derived claims. The prototype imposes a 30-second client-side use deadline from token-request start, also respecting any shorter explicitly reported expiry. That deadline is NOT Shopify's asserted token lifetime. On 401/403 stop; do not alter permissions or credentials automatically. Resource-server acceptance and subsequent billing processing remain observations to test.
5. After local tests and fresh Spec/security review, the owner may authorize the single integrated M0-012 run below: three distinct synthetic value:1 events, one exact duplicate, at most six event POST attempts and six token acquisitions across the entire package. This is no-charge transport/metering evidence, not real-price invoicing or full G8 acceptance.

No paid/live action is authorized by merely reading this document. The accompanying owner launch must be sent. No changes to v1.2 architecture, full gate passes, production protocol adoption, app-wide pricing enablement, or M1 are adopted here.

## Sources and scope

Checked 28 September 2026:
- https://shopify.dev/docs/api/partner/latest/interfaces/Price — price metadata, not a subscription-status field.
- https://shopify.dev/docs/api/partner/latest/objects/TieredPrice — concrete price fields.
- https://shopify.dev/docs/api/partner/latest/enums/TiersMode — VOLUME/GRADUATED semantics.
- https://shopify.dev/docs/api/partner/latest/active-subscription — current contract read and nullable result.
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing#testing — effective-zero development contracts.
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/migrating-to-shopify-app-pricing — draft usage tests before final Enable.
- https://shopify.dev/docs/api/app-events/latest — trusted issuance endpoint, documented default permission and lifetime; retrieved reference currently shows unstable.
- https://www.rfc-editor.org/rfc/rfc6749.html#section-5.1 — expiry metadata recommended, scope conditional; not evidence of this particular bearer being accepted.
- https://shopify.dev/docs/api/app-events/latest/creating-events — receipt versus async billing outcomes, event identity.

The direct 2026-07 App Events reference did not load in the principal's web tool. This is not proof that the 2026-07 API endpoint is unsupported. Resolve and pin the experiment's route as directed in the execution brief.
