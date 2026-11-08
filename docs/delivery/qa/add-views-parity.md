# Add views and image picker parity

**Observed:** 8 November 2026. **Purpose:** compare the accepted selected UI, current integrated source and the accessible local demo against the reported native Add views state. This is a bounded UI/history audit; no image was selected, uploaded, assigned, saved or published by this run.

## Quick result

The accepted UI already contained the Add views dialog and image picker. The integrated product editor reuses that picker and its CSS; its production wrapper adds an authenticated media-upload callback. In the local demo, the empty `No product images` fixture closely matches a zero-view, zero-placement initial state. The local error state does not match the reported native upload failure: the native cap-test owner reports `0 views · 0 placements` and `Techwerken_WA.png: The image could not be processed`; the user confirms they uploaded the PNG and it failed. I did not independently observe that dialog because my separate native product tab returned `Product could not be loaded` before and after one read-only Retry. I did not access the active manual-cap tab or use a file picker.

The reported native error is not evidence that PNG is unsupported or that the merchant selected a different file. Root’s separate browser regression reproduced the generic failure on the prepared `data:image/webp` path: `fetch(data:)` is blocked by the product page’s `connect-src` policy before a media POST. Root reports a bounded in-memory decode fix and passing CSP/media checks. That is local source/test evidence only; this report does not mark the current native image fixed or verified.

## History and composition

- **Accepted selected UI — `d490e4d0`:** `placement-workflow-preview.tsx` already rendered the Add views dialog and imported `placement-image-picker.tsx`. The picker had the multi-image selection, empty state, upload drop zone, populated library, search/filter, preview readiness and confirmation behavior. At that point `onUpload` appended prepared data to the in-memory local workflow.
- **Integrated wiring — `ccd1eb0c`:** the workflow moved into `frontend/admin/src/islands/SelectedProductEditor.tsx`, with `SelectedProductContainer` supplying authenticated persistence and media ports. The image-picker source gained an optional async `upload` callback after browser preparation; the production adapter passes `media.upload`, while the demo keeps its local adapter. The product route imports both `placement-workflow-preview.css` and `placement-image-picker.css`, so those styles are used by the live selected editor too. The latter file’s `Local placement workflow only` comment is stale.
- **After integration:** the only later selected-editor diff I found relevant to this path is `454fb05b`, which adds visible labels to production toolbar controls. No Add views markup, picker CSS or picker logic change is present in the `4a9cb951`/`f2a405f3` release history. PR253 (`da917701`) changes the shared Polaris dialog lifecycle/identity and adds browser regressions; it does not change picker content or upload processing. The observed native image predates that source fix, and the fix is not native-verified here.
- **Polaris/host seam:** the native route loads Shopify’s `polaris-2.0-rc.js`. The isolated preview substitutes the repository’s pinned Oct 20 Polaris 2.0 RC snapshot and local App Bridge/preview shims. Both render the same `s-modal`, `s-drop-zone`, search/select and picker markup, but the demo cannot establish Shopify host modal dismissal or real media-service behavior.

## Visible local states

The local demo ran at a 2560 × 1267 viewport. Its product setup selector was changed only to synthetic `No product images` and `Unconfigured product` fixtures. The current native modal viewport/content width could not be measured, so these screenshot-pixel dimensions are not a pixel-parity claim.

| State | Visible controls and copy | Approximate modal size |
|---|---|---:|
| Empty library, `No product images` | `Add views`; upload drop zone; `Accepts .jpg, .png, and .webp`; `Up to 5 MB per image.`; `No product images yet`; `Upload product photos to add them as views.`; Cancel; disabled Add view. Search and filter are absent while the image list is empty. | 620 × 394 px |
| Populated library, `Unconfigured product` | `Add views`; Search product images; All (4) / Unused (4) / In use (0); `0 images selected`; disabled Clear selection; same drop zone and size hint; four selectable thumbnails labeled Front, Back, Left side and Right side with Unused status; Cancel; disabled Add view. | 982 × 556 px |

The local populated example uses synthetic garment photos and does not claim a match to the native cap’s Shopify media. The closest known baseline is the local empty-library fixture. The native user-reported upload error adds an error state that was not simulated in the local demo. No successful native image/library row was confirmed, so cross-surface parity for populated search/filter/gallery remains unobserved.

## Upload boundary and current evidence

The shared picker accepts JPEG, PNG and WebP files up to 5 MiB, decodes and scales them to a maximum 1200 px edge, and encodes a bounded WebP data URL. In the integrated adapter, the prepared data URL is decoded, rendered to a PNG, and sent to the authenticated product-media endpoint; the returned preview is held as an object URL. Selecting that image updates the unsaved editor draft; the setup is saved separately. The local preview instead keeps the prepared image in its synthetic in-memory product. These adapter differences matter even though the picker markup is shared.

Root’s red browser regression identifies a local front-end CSP mechanism for the generic error: the product page does not allow `data:` under `connect-src`, so `fetch(prepared.url)` fails before the upload request. The reported native filename/error was not correlated to a native console or request trace by this audit. The bounded source correction must still be reviewed and deployed before native replay can establish that the user’s upload succeeds.

The source test status above was reported by root, not rerun here. This agent’s own native observation reached the generic product load failure twice, including one explicit read-only retry; it is retained as a screenshot because it blocked this comparison. That is an access/load limit for this run, not an Add views visual defect classification.

## Evidence

- Local empty picker: [demo-add-views-empty.jpg](../evidence/frontend-qa-2026-11-08/demo-add-views-empty.jpg)
- Local populated library: [demo-add-views-gallery.jpg](../evidence/frontend-qa-2026-11-08/demo-add-views-gallery.jpg)
- Separate native tab load failure: [native-add-views-load-failure.jpg](../evidence/frontend-qa-2026-11-08/native-add-views-load-failure.jpg)
- Earlier retained screenshots show the editor’s empty state and the affected host scrim after dialog dismissal: [orphaned-host-scrim-after-cancel.png](../evidence/frontend-qa-2026-11-08/orphaned-host-scrim-after-cancel.png), [variant-picker-orphaned-host-scrim.png](../evidence/frontend-qa-2026-11-08/variant-picker-orphaned-host-scrim.png). Those are historical host-dismissal evidence, not a current Add views or upload capture.

Artifact identities (`76d5d0f9` native image and `4a9cb951` local demo source) were supplied by the QA coordinator; I did not independently fingerprint either running artifact. The source-level upload correction, PR253 modal correction, deployment and native replay remain separate statuses.

## Coordinator's subsequent visual comparison

After this agent's run, the cap-testing owner exported [the actual native failed picker](../evidence/frontend-qa-2026-11-08/cap-png-processing-failure.png). The primary agent inspected it alongside the empty demo capture above. Both captures use a 2560 × 1267 outer viewport and the same compact empty-library composition. The native image adds the expected inline processing-error row; the heading, upload drop zone, format/size guidance, empty-state text and footer controls remain present. This supports the source-history conclusion that the picker was reused. It is not successful-upload, populated-gallery or exact native inner-width proof.
