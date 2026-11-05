# Scenario coverage

These thirteen fictional product records exercise the configurable customizer without implying that every merchant sells the same blanks or decoration options. Prices are integer euro cents. Each placement owns its allowed method IDs, size dimensions, and parallel size surcharges. Photo-backed entries map each configured view to a local source image; illustration entries use a generic garment silhouette tinted by the selected colour. The phone-case SVG is an explicitly labelled schematic fixture, not a product photo.

| Scenario | Colours | Sizes | Views | Placements | Methods | What it covers |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `classic` | 6 | 6 | 3 | 5 | Print, embroidery | Current six-color tee photography; mixed method availability; standard placement set. |
| `phone-case` | 1 | 1 | 1 | 1 | Print | Non-garment photo-config path, portrait source image, cutout-clear inset movement area, and relative size labels. |
| `colour-studio` | 24 | 6 | 2 | 2 | Print | Search, long option list, swatch overflow, and multi-color quantity entry. |
| `extended-sizes` | 2 | 14 | 2 | 2 | Print, embroidery | XXS through 6XL plus Tall sizes, restricted blank availability, long size rows, and mixed methods. |
| `minimal` | 1 | 1 | 1 | 1 | Print | Smallest valid configuration, single width, and artwork required up front. |
| `front-only` | 1 | 5 | 1 | 2 | Screen print | Single view and colour with two locations on one view. |
| `staff-polo` | 3 | 7 | 2 | 1 | Embroidery | One placement and one fixed method across a standard uniform range. |
| `team-hoodie` | 4 | 8 | 4 | 5 | Print, embroidery, heat transfer | Many placements across four views, including both sleeves; method choices differ by location. |
| `one-size-apron` | 3 | 1 | 1 | 2 | Print, embroidery | Multiple colour options and placements with a single size and no artwork-later option. |
| `many-placements` | 4 | 8 | 4 | 18 | Print, embroidery | Search and view filters; long placement labels; arbitrary view IDs; per-placement artwork-later permissions. |
| `many-widths` | 1 | 5 | 1 | 1 | Screen print | Twelve artwork widths from 6 to 28 cm; compact selection, artwork scaling and width-specific prices. |
| `large-palette` | 60 | 6 | 2 | 2 | Print | Floating search label, accent-insensitive search, stable scrolling, selected-colour recovery and long names. |

| `long-content` | 2 | 8 | 2 | 4 | Print, embroidery, heat transfer | Bilingual long product/colour/placement/method labels, unbroken size code, mixed availability and twelve chest widths. |

Expected adaptive behavior: hide or simplify colour selection for one colour; avoid dead view tabs when only one view exists; render one size without a redundant size matrix; show only methods allowed at the selected placement; and keep each placement's artwork, dimensions, method, and price independent. For multiple placements, changing a location should update the active view; focus is optional on desktop and automatic on phone. When all configured locations are in use, omit the add action.

Useful manual edge checks include searching among 24 colours, wrapping `Heather charcoal grey` or `Left sleeve near cuff`, scrolling the 14-size range, disabling sizes unavailable in a selected colour, switching between hoodie sleeves, and removing or undoing the first or last configured placement. The minimal and one-size cases should still permit quantities without forcing redundant selectors.


## Error, theme and content checks — 20 October 2026

`artifacts/premium/error-checks.json` covers missing artwork at two placements, visible summary and inline recovery, empty/invalid quantity correction and progression at 1440 × 1000, 390 × 844, 320 × 740 and 390 × 560 in both themes. It also checks System mode, manual preference persistence, media changes, denied storage and unmodified preview filters/blending.

`artifacts/premium/long-content-checks.json` covers full filename disclosure with keyboard access, extension preservation, gentle zoom, long configured labels, two colour rows, quantities of 999 and intact numeric columns at all three main widths in both themes. `upload-keyboard-checks.json` covers upload cancellation/recovery, unavailable-size keyboard progression and direct review editing.

A Sol agent reviewed the interface as a consumer. Its substantive finding about wrapping numeric totals was corrected; mobile Edit and filename targets were increased to 44px. This is a simulated review, not observation of real customers. Physical phone keyboards and native select popups remain unverified.

`artifacts/premium/state-audits.json` records 40 automated checks of empty, placement, artwork, upload-error, product, palette/search and gallery states at desktop and phone sizes in both themes, with no reported WCAG A/AA violations in those states. The quantity matrix adds 24 automated scans, correction flows add eight and long-content Review adds six. Automated scans do not establish full accessibility conformance.

Final layout checks also cover 1024 × 768 and 768 × 1024 headers, minimum mobile Edit/filename targets, no body overflow from hidden labels/captions, and the Review footer remaining at the viewport bottom while the panel scrolls.


## Neutral theme follow-up

The latest implementation uses full-width colour/size summaries, an expandable per-item cost breakdown and the existing footer total. It replaces the earlier fixed-column Review table. `artifacts/neutral-review/` records 72 ordering flows, six long-content checks, eight error-recovery combinations and 40 empty/dialog/product/picker/gallery accessibility checks. All recorded automated scans report no violations in their tested states.

`alignment-checks.json` records fixed badge geometry, centred numeral/check content, label alignment, header separation and no horizontal overflow in all three steps at 320, 390, 768, 781, 1024, 1440 and 2560px in light/dark. The same check verifies that dark surface, primary, link and structural border tokens are neutral greys and that the browser theme colour matches the panel. A separate Sol consumer review checked long-content with quantities of 999+999 at 320, 390 and 1440px in both themes and found no major blocker. The canvas blue-selection exception identified in that review was subsequently changed to a dark/light contrast pair.


## Implicit system preference and compact artwork rows

Current evidence is in `artifacts/theme-audit/`. The ordering matrix repeats all 72 flows, including the two-option Appearance picker. Long-content checks cover six width/theme combinations with filename disclosure and direct artwork editing. Forty state scans report no automated accessibility violations in the tested empty/dialog/product/picker/gallery states.

`theme-lifecycle.json` records 21 cases: Light/Dark defaults, old System and invalid storage values, live device updates before a manual choice, manual persistence, cross-tab changes, denied storage during navigation and early resolution with the app bundle blocked. `contrast-and-forced-colours.json` records focus/input contrast ratios and system-colour selection/focus cues while preserving source colour chips and illustrations. Browser emulation does not replace physical Windows, iOS or Safari testing.
