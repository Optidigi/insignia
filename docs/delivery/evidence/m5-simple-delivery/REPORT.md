# M5 simple delivery and session recovery

Owner source: [12 October direction](../../authority/simple-delivery-2026-10-12.md); entry8775caa3ba878109807e0ca3a7cf175d7246a102/tree024df50d37330c9d32aeb09101ead9fa6e60cbea. Live PR96 is already merged; no repeated merge or provider operation. Package SHA256SUMS entries all verified. The archived package and byte-identical prior active state, tooling and worklists remain dated evidence.

## Delivered behavior

After terminal authentication denial, the editor previously cleared private state and left only Authentication required with no configuration recovery action. The existing real built-browser control failed when attempting Retry session. A new explicit Retry session action requests a fresh App Bridge token through the existing bounded transport and only reloads the server's saved configuration. Repeated denial leaves private data absent; later successful authentication restores the saved clean draft and effective revision. Denied unsaved edits remain cleared. No Save/Publish/signing request is dispatched, no persistence is added and server authentication/tenant/generation fences are unchanged. Initial failed loads can also be retried. Current loading disables concurrent button gestures; existing request sequence fencing ignores stale responses.

This is a reproduced usability correction, not proof of the owner's native authentication cause. The earlier PR95/96 findings and results retain their meaning. The actual native interruption remains an unresolved acceptance issue until observed under current authenticated browser conditions.

## Consolidated instructions

AGENTS routes to one operating model. The full technical implementation plan retains its product/architecture/stack/feature sections; its governance, G7/M5 engineering timing and relevant check language now separate engineering readiness from native acceptance and rollout. The ledger records explicit supersession. Active state, M5/native worklists, role/tool/template instructions, project defaults and adapted pinned skills remove conflicting ratio, attempt-one, model/effort, seam-confirmation and universal-review requirements. Historical prompts, serialized/native evidence and frozen executables are not rewritten. Skill license/support/provenance remain, with project adaptations documented.

## Browser, research and operational boundaries

One T3 Default-profile capability/navigation check opens a working preview but the designated store redirects to Shopify login. No authenticated profile exists, and no further login/verification/Console attempt is made. Actual native flows are DEFERRED_OWNER_BROWSER; local browser/API/database/SDK development continues. Current deployed verifier,30-second policy, credentials and services are unchanged. Freshness simplification is authorized but no constant is lengthened or observation restamped in this change.

Independent current research inspected [Shopify ID-token guidance](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens), [SDK token-exchange guidance](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-app-express/docs/reference/guides/token-exchange.md) and a [firsthand App Bridge cached-token failure report](https://community.shopify.dev/t/app-bridge-v4-cdn-automatic-fetch-authorization-sends-expired-undefined-tokens-x-shopify-retry-invalid-session-request-doesnt-recover/32004). These support preserving bounded fresh-token recovery and native uncertainty, not claiming a new token-caching root cause. No server expiry/signature relaxation is justified by those reports.

Current owned product/configuration and all journals are reused, not recreated or mutated. Protected rewrite-dev stays installed. Unattended genuine uninstall/full privacy fulfillment remains an implementation limitation; conservative quarantine and allocated-store owner lifecycle handling are distinct, locally implemented boundaries. Full M10/M11 work is separately assigned, while actual M5 retention/cleanup obligations remain due.

## Qualification

RED: the mounted-browser expiry control cannot find Retry session after private clearing. GREEN: the same control passes repeated denial followed by successful read-only recovery, clean saved state and zero writes. All browser network/provider inputs are synthetic; no native acceptance is inferred. Build/typecheck, style, boundaries, secrets and session diagnostics pass. Broader merchant/browser/PG and SDK/visualizer/application checks and independent impact review are in progress; final results and CI are recorded on the actual candidate before local acceptance.

The first full web run completed145 passing controls and one cancelled/timed-out legacy control. That control waited for all s-button elements to disappear after authorization denial, which conflicts with the newly required recovery button. It now waits for the actual delayed PUT response, asserts only Retry session remains, and retains every private-editor/product/saved-message exclusion. No production guard or assertion of private-state clearing was removed. The failure is retained, not relabeled as infrastructure. Broader rerun is required after this changed expectation.
