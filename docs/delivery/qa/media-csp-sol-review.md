# Selected product media CSP independent review

Reviewed the two-file working diff in `/tmp/insignia-photo-pr-20261108` against `f2a405f3f1e729218a5b8633e4164c9f61ce7f70` on 8 November 2026. Scope is the selected picker's prepared raster data URL crossing the existing product-media upload adapter without a forbidden data connection. This uses the project code-review skill and the previously inspected project frontend, delivery and skill adaptation rules.

Reviewed source SHA256: `27eda0b22922180c487aaa8fd614c557eccdb810dee9e442193389ea50856dad`. New regression SHA256: `96a7daed5b891e6f3d6acdf64cdf1362e9f5a0b83f3aad30b2f1b614c62c1088`. Both exactly matched the clean test tree. `git diff --check` passed.

## Standards

No actionable findings. The implementation stays inside the existing media adapter. It changes no CSP, dependencies, backend contracts or selected UI. The new data URL branch caps the complete string at the picker's existing 1,000,000-character limit, accepts only base64 PNG/JPEG/WebP, and decodes into a typed byte array and Blob. `atob` receives a bounded string; malformed base64 or unsupported prefixes reject before the upload request. The byte conversion preserves binary character values.

The data URL is local preparation input, not ownership or upload authority. The server inspector, authenticated request port, setup authority header, upload UUID and PNG re-encoding remain in the existing path. The picker already limits preparation to a 1200-pixel edge and bounded WebP output. The new branch does not replace those limits or introduce a separate server trust decision. Non-data URLs retain their original fetch options and cancellation checks.

## Spec

No actionable findings. The production product route permits data images in `img-src`, while its `connect-src` omits `data:`. The old adapter fetched the picker's `data:image/webp;base64,...` URL, so its connection was blocked before upload dispatch. In-memory decoding removes that connection without relaxing the policy. Existing bitmap disposal, post-await lifetime checks, PNG size limit, private preview custody and revocation remain intact.

The new browser regression uses the real bundled adapter, external module scripts and enforced CSP. It creates the same WebP data URL shape as the picker, requires one PNG upload with the original UUID and endpoint, and asserts zero `connect-src` violations. Its authenticated request is a bounded double, so it verifies browser preparation and dispatch shape, not server inspection, persistence or native Shopify upload success. The existing browser case separately retains the non-data Blob path's retry byte identity and preview revocation checks.

## Independent verification and limits

With pinned Node24.21.0 in `/tmp/insignia-qa-clean-20261108`, I ran:

```sh
node --test frontend/admin/test/admin/selected-product-media.test.mts apps/web/test/admin/selected-product-media-browser.test.mts apps/web/test/admin/selected-product-media-csp-browser.test.mts
```

All six tests passed, with zero failures or skips. I also bundled the base adapter directly from `git show f2a405f3:frontend/admin/src/islands/selected-product-media.ts` in memory and exercised it in Chromium under `connect-src 'self'`. A data URL upload returned `Failed to fetch`, made zero upload writes, and emitted a `connect-src` violation with blocked URI `data`. This independently confirms the browser failure mechanism without changing source or the base tree.

The new regression deliberately records `connect-src` only. It does not prove every CSP directive is violation-free; the reported existing Zod JIT capability fallback can emit a separate `script-src` report. This review does not independently establish the user's particular PNG as the native failure's cause, nor qualify a deployed fix. Native console causation, the actual user PNG workflow, successful inspected upload/readback and deployment identity remain to be verified. Reported file validity and zero asset rows alone do not prove native CSP causation.

Standards: 0 findings. Spec: 0 findings. Local browser mechanism and bounded fix pass; native verification remains outstanding.
