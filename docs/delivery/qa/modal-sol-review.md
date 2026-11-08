# QA-001 independent implementation review

Reviewed the six-file working diff against `f2a405f3f1e729218a5b8633e4164c9f61ce7f70` on 8 November 2026. Scope is the mounted selected merchant dialog's host identity, X/Escape/Cancel dismissal, focus restoration and suspended picker resumption. The selected UI and write contracts remain unchanged. This review uses the project code-review skill, `AGENTS.md`, `frontend/README.md`, `.agents/skills/PROJECT-ADAPTATIONS.md`, the delivery operating model and QA-001's recorded expected behavior.

The reviewed wrapper has SHA256 `5890de37f8aadd0f4a14431a55d229d92ae40dedc346d1bfcbd9082d3019e465`. Source inspection covered all six changed files and their selected Methods/product consumers. `git diff --check` passed. After the implementation owner confirmed a matching clean web build, I independently ran the five new cases in `/tmp/insignia-qa-clean-20261108` with pinned Node24.21.0. All five passed, with zero failures or skips. The selection was `Shopify-hosted Add views|suspending the product picker|a resumed product picker` across the selected product and Methods browser suites.

## Standards

No actionable findings. The change stays in the shared selected dialog and existing browser fixtures. It introduces no dependencies, backend changes, alternate UI, authorization changes or private App Bridge implementation calls. The mounted UUID remains stable across rerenders and is independent of a component root's ID counter. Existing guarded focus restoration remains intact. There is no new server-rendering assumption: this dialog already reads `document.activeElement` and is mounted by the browser workflow.

## Spec

No actionable findings within the narrowed QA-001 scope. I independently inspected the pinned Polaris snapshot, SHA256 `89dd2052b7b8cc6b042900f5c044e1f5754e31bf769d205b6e2399992bdb0c7b`. Its modal implementation routes host show/hide by `this.id`, completes local dismissal through `onDismiss`, and calls `hideOverlay()` from `disconnectedCallback()`. The fix supplies a stable unique ID, lets Cancel follow the host dismissal path before `onClose`, and avoids a second explicit hide during ordinary open-modal teardown.

The suspension latch is set before initiating hide and survives a delayed `hide` event after resumption. Once that old dismissal completes, the still-active resumed picker is shown again instead of being canceled. The added browser tests exercise real selected routes with the actual pinned Polaris component and a bounded host double. They assert ID stability across a picker rerender, distinct IDs for concurrent picker/leave dialogs, X/Escape/Cancel closure, host scrim removal, returned focus and zero draft writes. The double does not establish native Shopify behavior.

## Verification limits and separate residual

This review does not claim deployment, native replay, owner visual acceptance or complete modal lifecycle qualification. QA-001's native closure still requires the exact deployed build to replay Add views and variant-photo X/Escape/Cancel/reopen with zero host scrims and no unintended writes. My five-case run independently observed the bounded browser behavior above. It did not use the actual Shopify host. The implementation owner's reported full affected suites, 22/22, web build and strict test compiler results are additional author evidence, not independent reruns in this review.

QA-009 retains a preexisting pending-host-show/unmount race outside this PR. I reproduced the upstream mechanism in Chromium using the exact pinned snapshot and Node24.21.0 from the clean QA tree. A host double deferred `_internal.modal.show`; after `showOverlay()`, synchronous element removal and release of the show promise, its call log contained only `show('review-modal')`, with the element disconnected and no host hide. Polaris awaits host show before opening its local dialog, while disconnected hide checks local open state. The old wrapper's explicit `hideOverlay()` had the same guard, so removing that call does not introduce this race. A future fix needs a failing selected-route regression and qualification of pending show, suspension and unmount together. No claim about native frequency follows from this isolated reproduction.

Standards: 0 findings. Spec: 0 findings within QA-001. QA-009 remains a separate lifecycle limitation.
