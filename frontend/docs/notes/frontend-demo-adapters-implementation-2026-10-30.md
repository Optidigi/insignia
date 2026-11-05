# Customer runtime and local preview adapters

30 October 2026. Implements the separation identified in [the read-only audit](frontend-demo-separation-research-2026-10-30.md) against the selected sibling `designer-prototype` Preact customizer. No backend, Shopify, checkout or deployment connection was made. The merchant demo harness is unchanged.

## What changed

`src/runtime.ts` defines narrow asynchronous artwork upload and cart commit ports. It owns effect cancellation, request identities, a separate idempotency key, and adapter calls. The existing pure reducer retains document edits, placement undo, quantities, validation, recovery and upload target/session guards. Its cart collection was removed. A saved design baseline is retained only for edit comparison. Open/closed state replaces a product URL route.

Commit now has pending, failure and applied-result events. It cannot close the customizer from a click, promise fulfillment without a receipt, mismatched receipt, rejection or obsolete response. Pending controls are disabled/inert while the document stays fixed. Closing or unmounting aborts outstanding work. The runtime and reducer both reject stale completions. Retrying an unchanged unconfirmed snapshot preserves its design ID and idempotency key, while each UI attempt gets a fresh request ID. A matching successful application retires the attempt; an independently started identical new design creates another host identity. This last case was added as a red regression after root review found an attempt-cache defect.

`src/demo/local-runtime.ts` owns the in-memory saved-design store and browser FileReader/image decode. It supports deterministic upload/commit failures, immutable returned snapshots and idempotent local replay. Its receipts explicitly say `local-preview`. `src/demo/local-designer.tsx` supplies that implementation, sample artwork, initial example designs, preview URLs and the existing developer host controls. `PreviewShell` and `AdminPreview` compose this local wrapper. `Designer` imports none of these modules.

The chosen UI and Shopify ownership remain intact. Verified adapter add/update closes the customizer, and the local wrapper returns to the labelled development `/product` stand-in. No customer cart, product-return or checkout UI was introduced. Light/dark layout, sample scenarios, upload recovery and local add/edit/resume remain available.

## Integration and deletion

A real host entry should import `Designer` and provide config, artwork references, optional `initialDesign`, stable ports, `isOpen` and `onOpenChange`. It should remount for a different product/design session. Closing hands control to Shopify. A production entry must not import the preview shell, admin preview bridge, local wrapper/runtime, host stand-in or scenario catalog. The runtime suite bundles the core in isolation and asserts this import-graph boundary as well as absence of fixture art, fake-host copy and FileReader code.

This port is not the backend wire contract. The current `ProductConfig`, `Design` and numeric estimate model remain local editor view models. Live integration still needs canonical IDs and capabilities, accepted uploaded assets, whole customized-cart subset composition, backend quote/acceptance and authorization, real Shopify line application and independent verification. The Review UI must be connected to authoritative currency/decimal-string minor amounts before enabling live purchase actions. No float-based preview estimate or receipt label is production authorization. Abort does not prove a remote mutation was rolled back; a real adapter must reconcile uncertain outcomes and honor the provided idempotency key.

## Verification

- `npm run check:runtime`: 12 passing public runtime/bundle checks, including delayed/rejected/malformed/stale commit, duplicate submit, cancel/reopen, upload cancel/replacement, immutable local add/edit, stable retry identity, idempotent local replay and two independent identical adds.
- `npm run build`: strict TypeScript and local Vite build pass.
- `npm run check:configs`: 66 config/model tests pass at the current combined source, including the other frontend agent's option-presentation work.
- Node 24.21.0, `INSIGNIA_DESIGNER_PROTOTYPE_ROOT=/Users/pc/Development/Insignia/designer-prototype node --test apps/web/test/admin/designer-cart-model.test.mts apps/web/test/admin/designer-state-browser.test.mts`: the last full run passed 28/28 before the final initial-design input and attempt-cache regression were added. Root should run the combined final source after the parallel label integration.

The browser suite uses the actual selected Preact source on an isolated loopback Vite port. A controllable injected local adapter exercises visible pending, failure, retry and close/abort behavior without external writes. It also produces current light/dark 1440px and 390px captures. Stable copies are under `/Users/pc/Development/Insignia/.artifacts/frontend-hardening-2026-10-30/demo-adapter-captures`; desktop light and mobile dark were visually inspected for the preserved layout. These checks are local/browser evidence, not real Shopify cart confirmation, physical-device testing, owner visual acceptance or release approval. The main design gallery was not changed.
