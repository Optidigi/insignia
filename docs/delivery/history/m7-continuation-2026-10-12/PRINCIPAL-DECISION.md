# Insignia — M6 engineering review and M7 authorization

12 October 2026 · Principal milestone decision

## Decision

**M6_ENGINEERING_SHAPE_ACCEPTED / NATIVE_ACCEPTANCE_DEFERRED**

**M7_ENGINEERING_AUTHORIZED**

Accept the submitted M6 engineering shape as a foundation for independent M7 implementation. This is not full native M6 acceptance, G7 acceptance, checkout acceptance, or merchant rollout approval. The limitations below remain open; they do not require another M6 planning-only PR before useful M7 engineering begins.

The current simple-delivery operating model remains authoritative. This decision creates no new orchestration policy, fixed reasoning prescription, test quota, first-attempt CI requirement, or per-PR principal gate.

## Reviewed integration and evidence

Repository: `Optidigi/insignia` · PR98

| Reference | Value |
| --- | --- |
| M6 entry / PR base | `36945927e3fedc72c44247ec8357eb669186c0c6` |
| Final PR head | `ac7eb8595f3a606c1b4460383519f61522529c95` |
| Integrated main | `31b92db714fc1bb90f4f2b417361c58c0deb2cf4` |
| Integrated tree | `9fe4bfc8abfccab0890fe6227e94bc181e7b5001` |
| Last product-source review | `061fb82f50ea293adc16a85e76f585e99de21920` |

The live PR is normally merged. Its ordered parents are the M6 entry and final PR head above, and its tree matches the submitted integration. All three final-head checks are successful: foundation `38307917167`, runtime `38307917176`, PostgreSQL durable core `38307917202`.

The final commit after the product-source review changes the engineering packet, review/state evidence, and a historical image-test fixture. It does not change the reviewed artwork implementation. That fixture correction has separately reported impact review and final-head CI.

I inspected the committed engineering packet, final independent reviews, relevant application/storage/HTTP/guest/inspector/database/authorization source, current milestone criteria, merge metadata, and final-head checks. I did not rerun the agent's PostgreSQL/OS/cloud/browser tests. The local-host ZIP and integration receipt were not mounted in this chat; their archive integrity and the agent's latest database-shutdown accounting were not independently verified here. The user reports that owned local test databases are stopped and watching is off. Preserve that closing receipt with the milestone record.

The packet's pre-integration references to pending CI/merge are superseded by the live GitHub results above, not evidence that another integration run is required.

## Engineering assessment

### Exact-byte storage and usable-state authority

The application takes a private snapshot of the bounded upload, inspects a separate copy, checks the original digest and declaration, records a manifest, and promotes the snapshot into a separate original object and PNG preview. The storage adapter conditionally creates immutable objects and reconciles conflicts/lost responses through actual byte equality. Both stored hashes are checked before the asset becomes USABLE. These are the right boundaries for the planned original-versus-preview contract.

Original downloads are authorized separately and served as attachments; preview access resolves only raster objects. Inspection includes full decode rather than metadata-only acceptance. The SVG policy is an explicitly restricted static subset, not a promise to accept every SVG construct.

### Inspection isolation

The implemented host runner uses systemd resource limits and bubblewrap namespaces with a cleared environment and restricted mounts. It has no unisolated fallback. The evidence reports actual local OS controls. That establishes a locally qualified engineering mechanism, not qualification of an arbitrary production Docker worker. Production upload admission requires an available qualified runner.

### Ownership and quote integration

Guest access combines signed App Proxy routing with a separate server-issued resource capability and current tenant/generation checks. Merchant original access is currently account-owner-only under the verified online grant; broader staff delegation is not implemented.

The artwork usability port copies server-verified scope and binds cached and transactional quote replay to resource authority. The final independent reviews reproduced and closed the earlier cross-session cached-replay defect. M7 must preserve this requirement at its actual request composition: browser-supplied asset IDs or tenant fields are not ownership authority, and cached acceptance must not bypass that authority. Existing authorized quote economics, signatures and expiry are not rewritten.

### Recovery and cleanup

The implementation has durable claim/state transitions, retry scheduling, immutable collection/expiry fields and independent cleanup progress. One failed asset need not block all other processing or deletion. Local recovery/cleanup evidence is useful and accepted for engineering progression.

This does not establish exact physical erasure at a promised deadline. Reusable upload URLs, late in-flight writes, provider lifecycle timing and stored copies remain separate obligations. Local correctness and native guarantees are distinct.

No new material engineering finding was identified in the inspected scope that requires withholding independent M7 implementation. This is a bounded principal assessment, not proof that every possible security or provider behavior has been exhausted.

## Open limitations and acceptance boundaries

| Open item | Meaning and required treatment |
| --- | --- |
| Native S3 request signing, length/CORS enforcement, expiry and App Proxy forwarding | NOT_RUN. The reported MCP object round trip proves a different interface. Retain these as native qualification, not implicit PASS. |
| Repeated use of presigned URLs | Exact per-request length is not a cumulative request/transfer quota. Do not represent admission counts as complete storage-abuse protection. |
| Erasure | Seven-day application retention and eventual cleanup are not deadline-exact deletion. Resolve the guarantees needed for real data before live buyer exposure; actual existing obligations continue now. |
| Deployment isolation | The current ordinary Docker worker is not qualified for the host inspection runner. Keep admission closed where the qualified runner is unavailable. |
| Supported artwork/access profile | Static SVG subset, PNG/JPEG, current size/resource limits and account-owner-only merchant access. Keep these limits visible; do not silently advertise broader file or staff support. |
| M5 carry-forward | Native authentication cause, owner-browser/G7 acceptance, genuine unattended uninstall/full privacy, temporary verifier supportability, existing fixture and retention obligations remain open. |

Missing native browser access does not block independent engineering. Use a supported, authorized autonomous route where available; otherwise record the precise supervised observation and continue safe work. A known application defect remains a defect, not merely a missing screenshot.

No new live buyer uploads, unsafe checkout exposure, production deployment, or rollout is approved by engineering acceptance. Appropriately allocated native qualification can proceed when its technical prerequisites and actual owner permission hold. Existing M5 access is not automatically a new storage, checkout/order, billing, or deployment allocation.

## M7 authorized outcome

Implement the existing plan's **complete storefront quote/cart purchase slice**: a buyer configures supported customization, uses verified artwork or permitted logo-later, reviews complete customized-cart economics, accepts a quote, and applies the authorized real-variant cart representation with safe renewal and repair.

Reuse the accepted M4 pricing/authorization ports, M5 configuration/geometry/publication contracts, M6 artwork lifecycle, and adopted whole-quote v2 and Function boundaries. Preserve the storefront visual reference, Preact/Custom Element/Shadow DOM shape and App Proxy boundary. Unsupported contexts must fail closed rather than silently becoming base-price customization.

The M7 outcome includes the planned placement/size/color quantities, distinct design groups, cart-wide repricing and buyer reacceptance, exact allocation, safe cart replacement and external-edit repair, expired/changed-context renewal, pending/rejected artwork handling, and supported checkout/accelerated-path behavior. Actual checkout and supported-capacity claims remain subject to the plan's assigned G1–G6 evidence. M7 engineering authorization is not a statement that those gates already pass.

The local agent owns task order, implementation choices, seams, research, tools, delegation, available model/effort selection, impact review and normal merges. Use meaningful TDD to produce working behavior and relevant regressions. Use inspected Matt Pocock skills and their support files when useful. Consult practical community/maintainer evidence and verify consequential assumptions against current contracts, source and observations. No forced hypothesis count, review ritual or new setup framework is prescribed.

Integrate the principal decision into the existing short state/acceptance index and make M7 the active engineering milestone. Keep M5/M6 deferred native work separately named and tracked; do not erase obligations to make the index look complete. Proceed directly into useful implementation without another principal planning approval. No M8 work or merchant rollout begins under this decision.

## Next principal boundary

Return at **M7 engineering readiness**, not after individual slices or PRs. Supply the integrated commit/tree, working storefront/quote/cart behavior, relevant local and native evidence with provenance, cumulative architecture/contract assessment, known defects, deferred native tests and cleanup/retention status. Required real-store criteria remain unpassed until actually demonstrated.

The principal then decides M7 engineering progression and any separate native acceptance. A material locked-contract conflict, actual incident or unresolved external mutation remains a legitimate exception; ordinary implementation choices stay with the agent.

## Source references

All repository file references below were inspected at integration `31b92db714fc1bb90f4f2b417361c58c0deb2cf4` unless another ref is shown.

- [PR98](https://github.com/Optidigi/insignia/pull/98)
- [Engineering packet](https://github.com/Optidigi/insignia/blob/31b92db714fc1bb90f4f2b417361c58c0deb2cf4/docs/delivery/evidence/m6-secure-artwork/M6-ENGINEERING-REVIEW.md)
- [Final Spec review](https://github.com/Optidigi/insignia/blob/31b92db714fc1bb90f4f2b417361c58c0deb2cf4/docs/delivery/evidence/m6-secure-artwork/review-r4-spec.md)
- [Final security review](https://github.com/Optidigi/insignia/blob/31b92db714fc1bb90f4f2b417361c58c0deb2cf4/docs/delivery/evidence/m6-secure-artwork/review-r4-security.md)
- [Full implementation plan](https://github.com/Optidigi/insignia/blob/31b92db714fc1bb90f4f2b417361c58c0deb2cf4/docs/architecture/implementation-plan.md)
- [Application artwork lifecycle and replay binding](https://github.com/Optidigi/insignia/blob/31b92db714fc1bb90f4f2b417361c58c0deb2cf4/packages/application/src/artwork/artwork.ts)
- [Storage adapter](https://github.com/Optidigi/insignia/blob/31b92db714fc1bb90f4f2b417361c58c0deb2cf4/packages/storage/src/index.ts)
- [Inspection sandbox](https://github.com/Optidigi/insignia/blob/31b92db714fc1bb90f4f2b417361c58c0deb2cf4/apps/worker/src/artwork/sandbox.ts)
- [Artwork HTTP authorization](https://github.com/Optidigi/insignia/blob/31b92db714fc1bb90f4f2b417361c58c0deb2cf4/apps/web/src/server/artwork/http.ts)
- [Guest authority](https://github.com/Optidigi/insignia/blob/31b92db714fc1bb90f4f2b417361c58c0deb2cf4/apps/web/src/server/artwork/guest.ts)
- [Database artwork repository](https://github.com/Optidigi/insignia/blob/31b92db714fc1bb90f4f2b417361c58c0deb2cf4/packages/database/src/repositories/artwork.ts)
- [Final-head checks](https://api.github.com/repos/Optidigi/insignia/commits/ac7eb8595f3a606c1b4460383519f61522529c95/check-runs)
