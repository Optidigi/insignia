# Current UI handoff

See [frontend/README.md](../README.md) for current ownership, launch commands and the example-only boundary. The notes below describe the earlier working checkout; paths and verification records may be historical. No backend integration is included.

# Insignia customer designer

Local UI prototype for the new Insignia, based on the legacy storefront's white and grey surfaces, blue selections, green cart action and icon set. Inter is hosted locally through Fontsource, with a system-font fallback.

From the repository root, run `corepack pnpm install --frozen-lockfile`, build `@insignia/ui-localization`, then run `corepack pnpm dev:designer -- --port 5173`. Open http://127.0.0.1:5173/. `npm run build` checks strict TypeScript and builds the static application.

For reviewing the accordion, http://127.0.0.1:5173/?example=accordion opens with sample chest/back prints and the chest section expanded. The normal URL still starts empty.

Left chest demonstrates optional customer positioning directly on the existing product preview. Drag the selected artwork inside its dashed boundary, choose an approved size in the artwork card, or use the directional controls. Reset preserves the paid size; Undo reverses the last size/position change for that placement. Mobile can enlarge the same inline preview without opening another screen. The phone-case schematic scenario tests a portrait product image and a safe area below the camera. Relative labels require no ruler. Configurations without `movementArea` retain fixed-position controls. `Print.position` survives local review/cart editing; this remains a visual prototype rather than production checkout support.

The customer experience is an Insignia customizer modal opened from Shopify. Shopify owns the surrounding product page, cart and checkout. The `/product` route is a labelled developer host preview only, not a customer-facing Insignia product/cart page. Local saved designs and completion results are test data; real Shopify add/update confirmation and host behavior still require a connected host adapter and authoritative quote review.

## Integration entry

The current source is part of the Insignia workspace. Read [the handoff](../../docs/frontend-handoff.md) for the selected admin/customer source map and integration boundaries. `corepack pnpm build:designer` emits `dist-library/designer.js` and `designer.css`; its entry is `src/index.ts`. The regular build and `src/main.tsx` are the optional local demo. Both consumers use one `packages/localization` source; no vendored translation archive is needed. Historical screenshot paths below refer to the original standalone development folder and are not shipped build inputs.

## Runtime and local preview

`src/designer.tsx` accepts `DesignerPorts`, `isOpen`, `onOpenChange`, optional initial artwork/prints or an `initialDesign` for editing, and an optional `renderClosed` callback. It imports no preview host, scenario catalog or browser upload implementation. The host should remount the editor for a different product/design session. `designer-state.ts` owns the document, baseline for dirty checks, undo, validation, modal state and request/results. It owns no saved-design collection or URL route.

`src/runtime.ts` coordinates two asynchronous effects:

- `artwork.upload(file, { requestId, target, signal })` returns an artwork ID, usable preview URL and dimensions. The local implementation reads and decodes a file in browser memory. A connected implementation must upload, inspect and return an accepted asset reference.
- `cart.commit({ requestId, idempotencyKey, design, artworks, operation, signal })` resolves with a matching `CartReceipt` only after the adapter has verified the requested cart application. A fulfilled promise without an applied receipt is a failure. Request IDs guard UI responses; the separate idempotency key and design ID survive retries of the same unconfirmed snapshot. A confirmed submission retires that attempt, so another identical new design gets its own identity.

While a commit is pending, duplicate submission and editor changes are blocked. Closing, navigation and unmount abort pending work. Aborted or superseded results cannot close the editor. Rejections preserve the draft and allow retry. Abort is a cancellation signal, not proof that a remote write was rolled back; a future connected adapter must reconcile uncertain results and preserve idempotency.

The local entry is deliberately separate. `main.tsx` mounts `PreviewShell`, which selects fixtures and the localhost merchant-preview bridge. `src/demo/local-designer.tsx` injects `src/demo/local-runtime.ts`, supplies sample artwork, owns the in-memory saved-design collection, navigates the development `/product` stand-in and renders `StorefrontHostPreview`. Its receipt authority is always `local-preview`. `createLocalRuntime({ failCommit: true })` and `{ failUpload: true }` provide deterministic failures for tests without pretending to be HTTP services.

For a connected entry, mount `Designer` directly with host-owned inputs and real adapters. Do not import `PreviewShell`, `AdminPreview`, `LocalDesigner`, the local runtime, `StorefrontHostPreview`, the scenario catalog or JSON fixtures. The host closes its modal in `onOpenChange(false)` and retains Shopify's own product/cart controls. The optional `renderClosed` callback is only a way for an embedding host to resume or load another design; the local preview supplies its developer controls there.

This is an integration boundary, not a production protocol or an implemented Shopify connection. `ProductConfig`, `Design` and numeric local model totals remain editor view models and preview estimates. Before enabling live purchasing, the host adapter still needs canonical configuration and asset mapping, guest capability, the complete customized-cart subset, backend proposal/acceptance and authorization, real Shopify line application and independent verification. Review must display the server's exact currency and integer minor amounts, carried as decimal strings in JSON. The current local price calculation must not authorize a production purchase. A `shopify` receipt label is a trusted adapter assertion for UI handoff, not authorization evidence by itself.

`npm run check:runtime` exercises the public runtime with delayed, failing, malformed, canceled and stale results, local add/edit, replay and independent identical additions. It also bundles `Designer` alone and checks that no local host, fixture catalog, sample artwork or `FileReader` implementation is reachable. The normal `npm run build` still builds the local Vite preview. The repository browser suite additionally checks actual pending/failure/cancel UI, uploads, add/edit/resume, history and light/dark desktop/phone rendering.

## Product scenarios

Open http://127.0.0.1:5173/scenarios for the fourteen configurable preview scenarios. Choose an empty start or a sample design, then switch product or starting state from the separate preview toolbar. Hide controls shows the customer layout at full viewport height. Switching scenarios resets all local state.

JSON files in `src/scenarios/` define the store, product options, views, positions, widths, methods, availability, images and demo prices. Optional option-presentation labels can name the row and quantity axes and show row choices as swatches or named choices; they do not change the local option matrix or connect it to Shopify variants. [SCENARIOS.md](SCENARIOS.md) explains the schema and the presentation-only phone-case fixture. Run `npm run check:configs` to validate the fixtures and model contracts.

The UI adapts to one or many options. Single row choices and views have no chooser; one quantity-axis value has a single quantity field; a single remaining placement adds directly. Methods and widths belong to each placement. The desktop row-choice list is bounded and searchable, and the phone picker sits at the right edge. Larger quantity axes wrap, and unavailable option combinations are disabled with a visible explanation.

See [UI-DATA-AUDIT.md](UI-DATA-AUDIT.md) for the store-data dependencies and production requirements. The Sponsor hoodie adds 18 positions with search and view filtering. Placement thumbnails use the configured photo or illustration and a marker derived from the same preview coordinates. Long filenames can be expanded in the artwork library, while compact controls preserve their extensions.

Artwork widths use a static value for one choice, buttons for two to six, and a native dropdown for longer lists. The Many artwork widths scenario contains twelve width choices. Focused checks cover one to 24 options at desktop, 390px and 320px widths, including selection, preview scaling, pricing, review and cart editing. Evidence is in `artifacts/width-options/`.

The Large colour range scenario contains 60 colours. Search uses a floating label and a clear action. The larger picker keeps its header and search visible while swatches scroll, and finds labels without requiring matching accents or word order. Checks and captures are in `artifacts/colour-picker/`.

## Control polish

Colour and placement search share the floating-label field, clear action and name matching. Placement search no longer autofocuses. View filters and longer width/method lists use a matching compact native select with a permanent label.

Empty quantity fields show a muted `0` placeholder inside a clearly bordered input. Enter moves to the next available size, then focuses Review at the end. Colour rows show their entered item count. Negative, fractional and over-limit values remain visible with an inline message; they are excluded from totals and block review until corrected. Removing or undoing a colour also removes or restores its validation state.

Review has explicit Edit actions that open the specific placement and focus its heading. Colour and size quantities use full-width summary rows. Unit pricing has one expandable breakdown, and the order total appears in the persistent footer. Truncated review filenames can be expanded with a keyboard or touch. Upload errors appear inside the upload area, support retrying the same file, retire when dismissed, and cancel older in-flight file reads when a newer selection is rejected. An unconfigured shipping statement has been removed.

Current captures and checks are in `artifacts/theme-audit/`; `artifacts/neutral-review/`, `artifacts/premium/` and `artifacts/polish/` record preceding iterations. The latest ordering matrix covers twelve scenarios at 1440px, 390px and 320px in both themes (72 flows). The focused tests cover field consistency, invalid quantities, keyboard progression, undo, direct editing and upload recovery. They are headless Chromium checks, not physical phone keyboard testing.

After a failed progression, a focused summary links to each affected control. Artwork and quantity errors also appear inline; the footer retains an issue-count action. Focused recovery checks include narrow phones and 390 × 560 short windows.

The header's 44px sun/moon button toggles Light and Dark, using the existing Polaris icons and switch semantics. With no explicit choice it follows the device setting, including live changes. A manual choice persists locally where storage is allowed and stays active across app screens when storage is denied. The icon shows the current theme; the switch exposes its Dark mode on/off state to assistive technology. Older saved System values are treated as no explicit choice. The dark palette uses neutral charcoal surfaces, restrained grey dividers, stronger input borders and neutral light primary actions. Semantic colours remain for errors, warnings and success feedback. Product photos and artwork retain their original colours on a neutral preview matte. Artwork focus is capped at a moderate 1.4× scale and remains optional on desktop.

The `long-content` fixture exercises bilingual merchant labels and an unbroken size code. Additional checks use a 200-character artwork filename, multiple colours and quantities of 999. Strict TypeScript and 47 config/model tests pass. These are automated and agent reviews, not customer research or a full accessibility conformance assessment.

## Current flow

Start empty, add artwork at a position, choose its width and method, then enter quantities and review. Each position keeps independent artwork and settings. The interface uses generic Artwork and Per item wording, including embroidery-only products.

Desktop keeps the full garment visible, with focus available as an explicit action. Phone focuses the area being edited. The garment fits the preview without the old 650px cap. Placement headers use the actual Shopify Polaris up/down icons from the legacy dependency, version 9.3.1. The entire header toggles immediately, with native button keyboard behaviour and hidden collapsed content.

PNG, JPG and SVG uploads up to 5 MB stay in browser memory. Removing artwork or a colour row offers Undo. Some scenarios allow artwork later; others require it before continuing. X or Escape closes the customizer and preserves the in-memory draft. The `/product` route is only a labelled developer host preview. Simulated add/update closes the customizer; the real Shopify host owns its product page, cart, confirmation and checkout. This prototype is not connected to Shopify.

State resets on reload. The normal preview warns before leaving a configured design. The explicit scenario lab allows scenario changes and reloads without that warning. There is no persisted draft, real upload service, Shopify cart mutation, checkout, payment or order creation.

## Assets and references

The 24 garment images cover six colours and four views from Superfunny's public product configuration. They total about 2.14 MiB after resizing to a maximum of 1200px and JPEG quality 82. [The asset manifest](public/product-image-sources.json) records provenance, dimensions and hashes. Sample artwork is original SVG content. Icons come from `insignia-legacy/app/components/storefront/icons.tsx`.

The installed Anthropic frontend-design skill matched the official skill at path commit `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f` when checked on 19 October 2026. [Reference notes](REFERENCE-NOTES.md) record the Vercel, Memorisely, Checklist Design and W3C sources and access limits. The layout decisions are design judgments, not claims that those sources prescribe this customizer.

## Verification

The config/model suite contains 47 tests. The current scenario matrix exercises all twelve products in both themes at desktop 1440px, phone 390px and narrow phone 320px through artwork, quantities, review, local cart, product return/reopen, scenario reset and hiding controls. Current ordering evidence is in `artifacts/theme-audit/matrix/`; historical evidence is in `artifacts/scenarios/`; additional placement and filename checks, including keyboard disclosure and responsive truncation, are in `artifacts/data-edges/`; agent consumer review is in `artifacts/scenario-consumer/`. These are automated and agent checks, not testing with real customers. Earlier captures below document the preceding design iterations.


Strict TypeScript and the production build pass. A separate Sol agent reviewed the interface as a simulated customer and exercised desktop, 390 × 844 and 320 × 740 layouts. This is agent review, not research with real customers.

Verified flows include the empty start, separate chest and back artwork, collapse/reopen, full/focused preview, colour search and selection, mixed sizes, review/edit, local add-to-cart, and return/reopen without losing the draft. No horizontal overflow was found at the tested phone widths.

The agent checked five garments with one chest print at €87.25 and five with separate chest and back prints at €187.25. A final visual recheck confirmed that the focused print outline follows the artwork proportions, with a separate transparent touch target.

Final captures are in [artifacts/consumer-review](artifacts/consumer-review/), including `desktop-final.png`, `mobile-focused-fixed.png` and `mobile-full-fixed.png`.

A follow-up DOM integration check verified focus restoration after dialogs, product return and reopening, plus colour-row removal/Undo with restored quantities and total. Undo remains available beyond the notification timeout. Recreating a removed row or placement retires its earlier Undo action. [The check report](artifacts/interaction-check.json) records the assertions. Local browser control was disabled for this follow-up, so this check covers application state and focus, not layout or native dialog behaviour. Earlier desktop and phone captures precede these interaction-only fixes.

The typography/layout refinement then used an isolated headless Chromium test browser at 1440 × 1000, 1024 × 768, 768 × 1024, 390 × 844, 320 × 740 and 390 × 560. [The rendered check report](artifacts/refinement/checks.json) records no horizontal overflow or clipped stress-test labels, correct divider alignment, separate preview-control rows, colour-picker selection, and accordion keyboard, interruption, hidden/inert and reduced-motion checks. Axe reported no automated WCAG A/AA violations in those configured states. This is not a full accessibility conformance assessment or a physical-device keyboard test.

Earlier screenshots are in [artifacts/refinement](artifacts/refinement/), named by width and height, such as `1440x1000-full.png` and `390x844-full.png`. This pass also updates the Vite development dependency to 6.4.4; `npm audit` reports zero known vulnerabilities.

The subsequent accordion correction replaces the custom icon and animated panel with Polaris icons and immediate toggling. [Its focused check report](artifacts/accordion/checks.json) and desktop/phone open/closed captures in that folder supersede the earlier accordion motion checks.

## Production integration

Use the new Insignia's independent placement artwork, method and dimensions contracts. Map all fixture IDs to merchant configuration. Production must supply real Shopify colour/size availability, contextual prices, authoritative quote/review/acceptance results, upload inspection and retention, and cart proposal/replacement semantics.

The local `/product` page demonstrates leaving and reopening the designer. The actual store return destination and embedding/navigation mechanism still need the host integration. Draft recovery across reloads needs storage and lifecycle handling.

The prototype remains English. Longer German navigation, view, placement and action labels are layout stress tests, not a shipped translation. Production still needs message catalogues, locale-aware copy and currency configuration, plus testing with actual translations and any right-to-left locales. The font includes Latin extensions, Greek, Cyrillic and Vietnamese subsets loaded as needed.

Preview positions and physical sizes are illustrative. Production needs validated image geometry for every view and variant; centimetre claims require configured physical dimensions or calibration. Relative size labels and normalized positioning do not require ruler calibration. Quality and contrast checks need original image metadata, selected dimensions and method-specific rules. Artwork-later and embroidery availability need merchant policy. Multiple artwork layers within one placement are not implemented.


## Neutral theme and Review refinement

The 20 October follow-up follows Vercel Geist's role-based grey scales and descriptive Entity/Description patterns. Review no longer repeats placement fees, colour subtotals and a second order total in a dense table. Artwork remains directly editable; the section Edit action also provides a clear route back. Size quantities have the available row width, including on phones. Expand Price per item to inspect base and placement costs. Actual garment colours and supplied image pixels are unchanged.

Step badges have fixed 24px boxes with centred lining numerals and completion icons. Alignment checks cover all three steps at 320, 390, 768, 781, 1024, 1440 and 2560px in both themes. The latest scenario matrix repeats the 72 ordering flows, with separate long-content, error-recovery and state accessibility checks. See `artifacts/neutral-review/`. These are browser and simulated-consumer checks; physical-device and assistive-technology testing remain outside this local pass.


## Theme audit and artwork density

The dark-mode review and source links are in [DARK-MODE-REVIEW.md](DARK-MODE-REVIEW.md). A small head bootstrap resolves the effective theme before the app bundle runs. One shared theme store keeps the picker, document colour scheme, browser theme colour, device preference and explicit choices in sync. Native option selects retain explicit themed backgrounds; the theme control itself is now an icon button. Focus rings and editable input borders have stronger light-mode contrast; forced-colour states preserve product swatches and distinguish selection from focus. Source media keep a light colour scheme so adaptive SVG artwork cannot change with the surrounding chrome.

Review artwork rows put placement and method/width on the same line when they fit, with the filename below. Long text wraps, and truncated filenames have a separate Full filename disclosure without changing the primary edit button's structure.

Evidence in `artifacts/theme-audit/` includes 72 ordering flows, six long-content Review checks, 40 state accessibility scans, 21 theme lifecycle cases, and light/dark contrast plus forced-colour emulation. The lifecycle cases include initial system preference, migration of the old System value, explicit persistence, device changes, cross-tab updates, denied storage and startup with the deferred application bundle blocked. The forced-colour check is Chromium emulation, not a physical Windows High Contrast test.


The icon-toggle follow-up uses a stable accessible name, `Dark mode`, with `role="switch"` and `aria-checked`. The visual icon changes with the resolved theme. Native button activation supports click, Enter and Space. Hover, focus and pressed states use theme tokens. Visible theme labels are removed; the accessible name and action tooltip still require translation in a multilingual integration. `artifacts/theme-toggle/checks.json` records focused behaviour/accessibility checks at 1440, 1024, 390 and 320px. Only TypeScript and the affected control were rechecked for this change, not the ordering suite.


## Superseded product-return experiment, 25 October

**Removed on 28 October.** This experiment incorrectly presented an Insignia-owned product/cart page. The customizer is a modal opened from Shopify, and returns control to Shopify after verified add/update. The historical evidence below is not the current design. Current `/product` is only an explicitly labelled developer host preview; it has no cart management UI.

The customer-facing `/product` page now separates base pricing, saved cart designs and unfinished editor work. Saved entries show their colour/size quantities, print placements, amounts and individual Edit actions. Editing an earlier design updates that entry in place. Personalise another starts a separate design; Continue customising preserves an unfinished draft. Switching to another saved design asks before discarding unapplied changes. The return page remains an in-memory demonstration, not a Shopify cart or checkout.

The former grey bands around the white product photo came from sizing a contained image against a different media matte. This page now uses a square white photo frame, without filters or blending. The source JPEG already has a white background; garment pixels and the editor’s existing media treatment are unchanged.

Fresh light/dark captures at 1440, 790, 390 and 320px, six workflow checks, six page/content/media states, source scripts and two independent Sol reviews are in [artifacts/post-cart-review](artifacts/post-cart-review/). Strict TypeScript/production build and all 62 config/model checks pass. The focused browser checks cover saved/draft separation, two designs, updating an earlier entry, Escape/cancel focus return, confirmed switching, long text, illustration and failed-photo recovery. These are local browser/agent results; physical devices, assistive technology and production cart integration remain separate.

The final edge review caught a cropped portrait phone-case source. A rendered containment check first failed at 288 × 480px inside the 288px square frame. Giving the media a definite positioned containing block fixed the crop; all eight theme/width captures and six edge cases were rerun. The full portrait source now fits without cropping.


### Long-copy correction

The first return-page pass kept long content within the viewport but still gave it too much visual weight. The follow-up bounds the initial product name and description to three lines each, with one combined, measured Show product details control. Full merchant text remains in the DOM and expands in place; fitting short copy needs no extra control. Colour names and size quantities have their own rows, while Edit sits beside the design amount. The photo caption is omitted when that colour is already listed in the cart. Short placement names remain visible; only a list that exceeds two lines receives a count disclosure. Owned draft/dialog text is shorter, and the post-cart helper sentence is removed.

[Long-copy evidence](artifacts/post-cart-review/long-copy/) covers 16 long/short, light/dark, 320/390/790/1440px flows, keyboard expansion/collapse and intact merchant text. The new heading regression failed at seven initial lines before the fix. Existing six retained-draft/multi-design workflows still pass. Additional checks cover long size codes, multiple quantity rows, more placements and focus during layout changes. Both Sol reviewers reassessed the final source and rendered long-copy versions. This corrects the earlier claim that simple wrapping alone made those versions ready.


## Explicit option data

Quantity presentation is automatic. `quantity-layout.ts` chooses single, compact, grid or long-label list entry from the configured tuples and labels. `quantity-entry.tsx` renders the choices through the existing reducer. The policy does not inspect product names, current stock counts or entered quantities. Small sets support mixed quantities without adding rows manually; grids retain direct size entry. Long option lists support search without hiding selected or invalid entries. A retained unavailable or retired selection has an explicit Remove action before Review can continue.

`npm run check:configs` includes the adaptive quantity policy/reducer checks. `npm run check:quantities` runs those checks alone. The maintained browser suite in the adjacent Insignia repository verifies all fourteen scenarios at desktop and phone widths, plus sparse, three-axis, filtered-edit and unavailable-state examples.

The step labels are Artwork, Quantities and Review for every product. Optional `optionPresentation` has `rowOption: { label, display }` and `columnOption: { label }`. Labels are displayed unchanged; no singularization, pluralization, product classification or colour-name lookup is used. Missing metadata uses generic named choices. Swatches require explicit hex data; hex is optional for named choices.

Each row requires an explicit `availableSizeIds` list, including an empty list when nothing is available. For real Shopify inputs, `buildShopifyVariantMatrix` accepts canonical numeric variant IDs, explicit availability and selected option name/value tuples from `m7-config-v2`. It rejects missing/ambiguous metadata and preserves only actual combinations. Its output supplies the row/column view, exact `variantMatrix` and availability lists; parse the merged product view model with `configSchema` before mounting Designer. A config change starts a new mounted design session. The complete Shopify host/quote/cart integration is still not implemented.

The runtime derives `Design.variants` from current mapped cells and quantities. A local fixture without exact identities cannot accept a Shopify-authority receipt. Numeric/GID aliases, fabricated combinations and numeric coercion are not accepted. Run `npm run check:variants`, `npm run check:runtime` and `npm run check:configs` for focused contracts.

`artworkOnly` limits the UI to an artwork preview. It hides quantity navigation, commerce footer, all price cues and theme controls; its scope notice remains visible. The normalized merchant preview DTO carries only supported photo/area/method choices, with an explicit appearance selection when required. Internal zero amounts represent option eligibility in that adapter and must not be used as buyer prices or currency evidence.
