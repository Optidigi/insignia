# Dark mode review

Reviewed 20 October 2026. Scope: `src/theme.tsx`, `src/theme.css`, `src/style.css`, `src/polish.css`, `src/review.css`, and the head bootstrap in `index.html`. This report records a source review and calculated contrast samples. It does not certify browser or accessibility conformance.

## Findings and implemented fixes

The current implementation uses neutral charcoal chrome, semantic colour variables, explicit feedback colours, and an intentional light product matte. That is a defensible fit for a garment designer where product and artwork colours need to stay recognisable. This is a project judgement, not a claim that every dark interface should use this palette. [Geist colours](https://vercel.com/geist/colors) separates component backgrounds, border strengths, high-contrast fills, and text roles. It supports this role-based approach without prescribing these exact hex values.

| Earlier issue | Current source and resolution |
| --- | --- |
| System was a third visible choice. | `theme.tsx` now renders only Light and Dark. `ThemePreference` is `Theme \| null`; null follows the OS until an explicit choice. Legacy stored `"system"` parses as null. The select displays the effective theme. |
| Storage denial could lose a choice when controls remounted. | A module-level preference retains the choice for the current document. Defensive localStorage reads/writes provide persistence when available. A shared `useSyncExternalStore` keeps mounted controls consistent; storage events update other tabs and the media listener updates implicit preference. |
| Theme resolution waited for the application bundle. | `index.html` now resolves preference in the head and sets `data-theme`, inline `color-scheme`, and theme-colour metadata before the application runs. Runtime code repeats the same resolution rules. The `color-scheme` meta tag declares both supported schemes. |
| Light focus was too pale. | `theme.css` now sets light `--focus: #2563eb`, replacing `#93b5ff`. Global controls, disclosures, and validation use the token. Canvas artwork retains its independent two-colour focus treatment. |
| Light editable boundaries were weak. | Light `--border-input` and `--border-control-hover` are now `#838d9c`. Floating search/select use the input token; quantity fields use the stronger hover token in `polish.css`. Decorative dividers stay quieter. |
| Appearance select background became transparent. | `polish.css` now keeps `background: var(--surface)`, retaining an explicit native-control background and foreground. |
| Selected width and colour states could disappear in forced colours. | `theme.css` now supplies an inset `Highlight` outline for selection and an outer `Highlight` outline for focus. The swatch selection ring also uses `Highlight`. |
| CSS swatches and garment SVGs could be recoloured by forced colours. | `forced-color-adjust: none` is scoped to source-colour chips/checks and garment illustration SVGs. Swatch borders use `CanvasText`; surrounding controls retain user palette adaptation. |
| Dark wrapper clipping could cut overlay focus and hit targets. | `.garment-image-wrap` now has `overflow: visible`; the photo receives the wrapper radius. Other containing layers still merit edge-placement testing. |

The initial OS preference followed by an explicit override matches the pattern described by [web.dev](https://web.dev/articles/prefers-color-scheme). Geist's [Theme Switcher](https://vercel.com/geist/theme-switcher) demonstrates three choices; this project's requested two-choice control takes precedence. Once manually changed, the UI intentionally offers no return-to-system choice.

The head scheme declaration, matching browser theme colour, visible keyboard focus, and explicit native select colours address the relevant [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines). [MDN's forced-colors documentation](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/forced-colors) explains why the additional selection outlines are needed: forced colours replaces author colours and removes box shadows.

## Contrast samples

Calculated from the current opaque sRGB values using the WCAG relative-luminance formula. Ratios describe these pairs only, not every rendered state or image background. [W3C non-text contrast guidance](https://www.w3.org/WAI/WCAG21/understanding/non-text-contrast.html) requires identifying which visual boundaries or state indicators are necessary, rather than applying the same rule to every decorative line.

| Pair | Ratio |
| --- | ---: |
| Light focus `#2563eb` / white | 5.17:1 |
| Light editable border `#838d9c` / white | 3.36:1 |
| Dark editable border `#737373` / panel `#212121` | 3.40:1 |
| Dark primary text `#ededed` / panel `#212121` | 13.75:1 |
| Dark muted text `#a3a3a3` / selected surface `#323232` | 5.08:1 |
| Dark focus `#bdbdbd` / panel `#212121` | 8.57:1 |
| Dark button fill `#e6e6e6` / label `#202020` | 13.05:1 |

The prior pale light focus measured 2.04:1 against white; the prior quantity boundary measured 1.91:1. Both identified pairs are now stronger. Error, warning, and success roles have separate foreground/background tokens; field errors also include text and structural cues.

## Product image integrity

The inspected navy source JPEG has a white background. The base light layout uses `mix-blend-mode: multiply`; dark mode explicitly removes that blend and presents the original photo and artwork on a neutral light matte. No image inversion or blanket dimming is introduced. Source media containers use `color-scheme: light` to keep adaptive SVG image behaviour stable. Artwork remains separate from the surrounding dark chrome.

web.dev discusses optional recolouring for some editorial images. That recommendation is context-specific and is not applied to this product-colour preview. The matte and unfiltered source pixels are the chosen approach here. It still needs visual checking with white garments, navy/black garments, transparent artwork, and artwork that contains its own opaque background.

## Remaining follow-ups

- Run physical Windows/Edge or Chrome checks for native select popups, High Contrast themes, selected width/colour versus keyboard focus, and preserved swatch borders. Emulation does not replace those checks.
- Run Safari on macOS and iOS checks for first paint, native selects, browser chrome, storage restrictions, orientation changes, and touch targets. Test both OS themes, then a persisted manual override and reload.
- Keep theme lifecycle regression checks when changing the theme store. The accompanying browser checks now exercise same-document navigation, cross-tab changes, localStorage denial and clearing the stored key. Multiple simultaneously mounted controls were not a product state in this pass.
- Consolidate overlapping CSS and semantic aliases after the visual direction settles. `--accent`/`--link`, `--muted`/`--text-muted`, and several surface aliases currently add indirection. Repeated selector rules across style/theme/polish are order-sensitive. `main.tsx` currently imports them in the intended order, followed by review styles.
- For production, carry the head bootstrap into the host template and account for its inline script in the site's Content Security Policy with an appropriate nonce or hash. Keep bootstrap and runtime preference parsing in sync. A future server-rendered integration would also need a server snapshot and browser-global guards; the current implementation is a client-only Vite app.
- Keep text/error wrapping and keyboard focus checks in the scenario review. `review.css` uses the shared tokens and already handles long filenames and disclosure focus; no additional theme-specific defect was identified there.

No further palette redesign is justified by the reviewed source and sampled pairs alone. Physical-device checks and edge states remain open.

## Source coverage

Primary guidance prioritised the requested Vercel Geist and interface sources. web.dev supplied browser implementation guidance; MDN supplied forced-colours details, with W3C used for contrast interpretation. Checklist Design's attempted design-token URL could not be retrieved, so this report attributes no claims to it. No relevant Memorisely material was retrieved and none is used as evidence.


## Accompanying browser verification

The implementation pass recorded evidence in `artifacts/theme-audit/`. The 21 lifecycle cases cover both OS defaults, old System/invalid storage migration, device changes before an override, manual persistence/reload, cross-tab events, storage removal, denied storage during designer/product/gallery navigation, and head-time resolution while the deferred app bundle is blocked.

The contrast/forced-colour check confirms the sampled focus and input border pairs above 3:1, an explicit Appearance-select background, a stable light colour scheme on source media, selected versus focused width outlines, preserved swatch RGB values and illustration preservation in Chromium forced-colour emulation. It is not a Windows device test.

The full matrix repeats 72 ordering flows across twelve scenarios, three widths and both themes. Six long-content Review checks include keyboard filename disclosure and direct artwork editing. Forty empty/dialog/product/picker/gallery state scans report no automated accessibility violations in those states. Strict TypeScript, the production build and 47 config/model tests also pass. Those checks do not establish full accessibility conformance.


## Icon control follow-up

The later header refinement replaces the native Appearance select with a 44px Polaris sun/moon button using switch semantics. Its stable accessible name is Dark mode; `aria-checked` exposes the resolved state. Click, Space and Enter toggle immediately, retaining focus. This supersedes the report's Appearance-select-specific discussion; the explicit-background guidance remains relevant to the other native selects. Theme storage, implicit device defaults and source colour treatment are unchanged. Focused control checks and TypeScript pass; the full suite was not repeated for this small change.
