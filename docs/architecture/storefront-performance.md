# Selected UI performance

The 8 November implementation preserves the PR223 presentation and reducer-owned workflows while moving avoidable work out of customer interactions. The [state audit](selected-ui-state-audit.md) maps storefront and merchant states, effects and motion to `d490e4d0e285b7b5be50da52cdf97474ff4a0e0f`. [Current delivery state](../delivery/state.md) distinguishes implementation, deployment and native qualification.

## Measured starting point

One native Chromium journey on the fully configured development T-shirt recorded Review readiness after 10,109ms, including a 7,182ms quote proposal. Add to cart took 7,426ms before navigation, including 5,404ms acceptance. A 21,882-byte artwork transfer took about one second, but two-second browser status intervals delayed usable preview to about 6.5 seconds. These are observed request waterfalls, not cold-cache benchmarks or percentile guarantees. “Checkout” in this report means Designer Add to cart, before Shopify payment.

## Qualified follow-up results

The current native speed rollout applies the bounded storage and preparation changes below. Observed journeys on the same configured development product were:

| Operation | Earlier observation | Current observation |
| --- | --- | --- |
| Same21,882-byte PNG, Chromium |6867ms |2379ms |
| Same PNG, Firefox |6575ms |2547ms |
| Review click to editable controls |82ms in first performance rollout |11ms |
| Review click to authoritative Add readiness |10109ms before performance work |7989ms |
| Immediate Add to cart navigation |7426ms in the starting journey |4622ms |
| Prepared opening |16–144ms in first performance rollout |17–213ms |

These are individual observations, not percentiles or identical cache/network-age guarantees. The starting cart journey clicked Add18.6seconds after Review became ready; the current one clicked immediately, both within the finite evidence window. The later8959ms sample waited87.6seconds and required fresh collection; it is a distinct cold-proof case. Current Firefox direct cache-disabled opening is2105ms. A loader remains necessary for cold/failure recovery.

The current quote proposal still took6193ms and total authoritative Review7989ms. Configuration/pricing and finite release verification remain real network work; the visible Review can be edited or left while it runs. Removing that preflight requires typed drift/presentation recovery that the current client does not supply. Further producer/protocol changes must preserve current-time checks and provider-attempt settlement rather than silently extending the proof window.

See [native evidence](../delivery/evidence/technical-merchant-completion/native-speed-followup-activation-2026-11-08.json) and the state audit for scope and remaining recovery limits. Sol high review approved the artwork changes; a fresh review approved the release-only preparation contract. The rejected early-assertion variant was never shipped.

## Initial native rollout and remaining work

The first performance rollout is active on the fully configured T-shirt. Prepared opening measured16ms in Chromium and144ms in Firefox; a separate cache-disabled direct Firefox opening measured2118ms. The selected editor and normal cold/failure recovery remain distinct. Review editing became available in82ms, while its authoritative quote remained8937ms.

The same21,882-byte PNG still needed6575–6867ms. Native correlation separates3213ms of queue/storage processing after completion from1334ms of polling lateness, plus preview delivery. Representative original/preview reads measured336ms/271ms; they do not retroactively split every pipeline phase. The follow-up source overlaps only each independent immutable write/readback pair and drains both before releasing custody. Early status polling is500ms for six seconds of accumulated pauses, then2seconds; request time is additional and the existing240-second pause budget remains. The qualified follow-up above now records native improvement; these earlier observations explain the change.

A delayed Add took8959ms after the user waited87.576seconds beyond Review readiness, so its30-second proof had expired. A distinct immediate Add using artwork-later took4289ms. These are not identical uploaded-artwork benchmarks. Release collection still occupies several seconds; the deployed narrow preparation overlap retains a current-time final readiness assertion after availability. It introduces no authority cache or periodic refresher. The full presentation preflight remains necessary for prices, wording and explicit publication-drift recovery.

## Implementation

- One visible product trigger per page prepares immutable editor assets and public presentation on idle; explicit hover/focus can transfer this background preparation to another product. A hidden, inert, nonmodal selected frame can initialize without taking focus or locking scrolling. Actual opening reuses that frame. Context changes, disconnection, failure and expiry retire preparation; assigning the same context preserves it. Failed hidden photos stop refreshes instead of looping through rotating URLs. Cart repair and owned-design reads remain user-initiated. The short presentation cache is capped by actual signed-image expiry; it supplies no purchase authority.
- Quote preparation has a distinct `preparing` state. Back/edit/close remain available; only purchasing waits for a ready quote. One automatic preparation can start while quantities settle; further typing does not spend another session proposal slot. Review reuses unchanged preparation, while edits or retirement cancel obsolete work. Actual cart submission retains its blocking pending state, stable retry identity and matching receipt checks. Clean completion still permits Done without another preparation or purchase.
- Current configuration and cart observation overlap. Foreign product reads are deduplicated within preparation and processed with bounded concurrency. New draft UUIDs use atomic server CAS0 creation, and actor-local acknowledged versions avoid repeatedly restoring preview payloads before updates; conflicts and lost acknowledgements still use scoped reads. Restoration never treats this metadata as ownership.
- Quote preparation overlaps independent shop/subscription and product reads. Acceptance performs fresh shop/catalog comparison inside its existing fence instead of repeating a whole preparation at signing. Final tenant, entitlement, market, artwork, day, readiness and material-hash checks remain. Readiness work overlaps independent observations without restamping their timestamps or extending validity.
- Upload status uses a short initial interval with bounded backoff; the existing inspector scans pending work more promptly. Original customer artwork remains unchanged and inspected. Publication overlaps bounded photo IO while serializing the existing single decoder; deterministic identities, drained failures and partial-capture custody remain.
- The final cart-attribute update uses Shopify's complete response as its normalized post-write witness. Post-add reads, the post-removal checkpoint, mutation lock and whole-cart goal checks remain. Small best-effort application confirmations are dispatched with keepalive before returning the receipt; oversized notifications retain awaited delivery. Confirmation remains UX reconciliation, never purchase/payment proof.
- Retiring a Method screen aborts catalogue/product reads. Already-dispatched Method writes retain their journals and receipt handling.

No replacement editor, new animation system, websocket service or caching authority was introduced. Existing theme, focus, keyboard, Undo and reduced-motion behavior remain owned by the selected components. Cold/failure recovery remains available; immediate prepared opening is not a promise of zero latency on an offline connection.

## Verification and rollout

Focused cases cover stale/canceled preparation, unchanged retry identity, usable upload and inspection failures, worker polling, concurrent capture bounds and decoder exclusivity, in-fence price/shop drift, cart-response tampering and Method-route retirement. Chromium and Firefox exercise the actual selected frame. Exact final CI artifacts and native measurements are recorded in delivery state before any deployment claim.

The worker scan runs in the separate immutable artwork-inspection host package. Updating the web or ordinary worker container alone does not deploy that change. Its existing service, credentials, socket protocol, sandbox and grants must remain intact during the qualified package replacement.
