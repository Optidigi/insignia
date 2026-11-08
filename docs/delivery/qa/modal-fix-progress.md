# Shared MethodDialog host-routing fix

Date: 8 November 2026. Working branch: `codex/integrated-ui-qualification`; review baseline: `4a9cb951`. The source and five focused test/support files are local, uncommitted changes.

## Change

[method-dialog.tsx](../../../frontend/admin/examples/admin/support/method-dialog.tsx) now assigns each mounted modal a `crypto.randomUUID()` ID stored once in a Preact ref. This stays stable across rerenders and is collision-resistant across separate Preact island roots; Preact 10.29.8 `useId()` is stable and unique within one root, but its root-local counter can repeat across independent roots. The selected Methods and product editor routes each hydrate one Preact island, and both dialog workflows initialize closed, so the ID is generated only on client-side modal mount and does not enter SSR hydration.

Cancel now calls `s-modal.hideOverlay()` and lets `afterhide` close the owning state after Polaris completes the host dismissal. Focus restoration remains in the unmount cleanup. The wrapper no longer sends its own additional hide during unmount; the pinned Polaris element hides an already-open overlay from `disconnectedCallback()`. A suspended hide is marked at the time suspension requests it. A late local `hide` event preserves that marker, and `afterhide` reopens the modal if its parent resumed it while the host dismissal was pending.

The [Shopify Modal API](https://shopify.dev/docs/api/app-home/v1.1/apis/user-interface-and-interactions/modal-api) documents ID-addressed `show(id)` and `hide(id)` for `s-modal`. The regression fixture follows the pinned `polaris-2.0-rc.snapshot` route (`window.shopify._internal.modal`) and models an ID-routed host scrim plus the Polaris `onDismiss` callback. It is a deterministic local host stand-in, not native Shopify evidence.

## Regression evidence

The baseline red run used the built clean worktree at `4a9cb951` before the source fix. Four cases failed with the reported behavior: host X and Escape left Add views visible; Cancel removed the app modal but left the fake host scrim attached; concurrently mounted Method dialogs had empty IDs. After introducing IDs and the Cancel hide path, the deferred-dismissal test also went red against the intermediate lifecycle: it timed out waiting for the resumed product picker to reopen after a delayed host dismissal.

With the final source copied into `/tmp/insignia-qa-clean-20261108` and built using pinned Node 24.21.0:

- `corepack pnpm --filter @insignia/web build` passed. Astro reported 0 errors, 2 hints; the minified chunk-size warning remains an existing build warning.
- The five new cases passed: Add views X, Escape, and Cancel clear the host scrim and restore trigger focus; concurrent Method dialogs have distinct IDs; a resumed picker survives a delayed host dismissal. Add views close paths assert no mutation.
- The affected browser suites passed 22/22: `test/admin/selected-product-browser.test.mts` and `test/admin/selected-methods-browser.test.mts`.
- `corepack pnpm exec tsc -p tsconfig.admin-test.json --noEmit`, Biome on the five changed test/support files, and `git diff --check` passed.

The focused browser suite commands, run with `PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH`, were:

```sh
node --test --test-name-pattern='Shopify-hosted Add views|concurrent method dialogs|resumed product picker' test/admin/selected-product-browser.test.mts test/admin/selected-methods-browser.test.mts
node --test test/admin/selected-product-browser.test.mts test/admin/selected-methods-browser.test.mts
```

## Limits

This does not close QA-001 as a native finding. No native Shopify replay, deployment, or native visual acceptance was performed. The separate pending-show/unmount race is tracked as QA-009: if Polaris's host `show` promise is still pending when its component is removed, the pinned element can skip its disconnected hide because its local dialog is not yet open. This patch intentionally does not call App Bridge directly to cancel that pending show, and does not claim that async unmount case is fixed.
