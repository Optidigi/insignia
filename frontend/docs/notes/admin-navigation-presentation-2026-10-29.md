# Admin navigation presentation

29 October 2026. Local implementation of the owner's request to reduce visual popping between merchant pages. The customer customizer, Shopify cart integration, backend and native host behavior are unchanged.

## Diagnosis and sources

Warm, browser-cache-disabled and CPU/network-throttled filmstrips reproduced staged presentation. The main page stylesheet was already present before reveal. The loading markup changed when Polaris registered its custom elements; the content appeared separately, followed by some SVG icons. The local preview also updated its heading/actions independently. This was not evidence of a Preact limitation or a new regression.

Official [Preact hooks guidance](https://preactjs.com/guide/v10/hooks/#uselayouteffect) and [React's useLayoutEffect reference](https://react.dev/reference/react/useLayoutEffect) distinguish pre-paint layout work from ordinary effects. Neither hook waits for downloaded assets, and React warns against expensive paint-blocking work. [MDN's whenDefined reference](https://developer.mozilla.org/en-US/docs/Web/API/CustomElementRegistry/whenDefined) guarantees registration, not completion of every internal render or network request. [Google's layout-stability guidance](https://web.dev/articles/optimize-cls) recommends reserving known geometry for pending content.

The installed Shopify skill, App Home topic and matching Polaris 2.0 RC runtime/types were checked. The pinned public Icon API has no supported all-assets-ready event. A private updateComplete property is not an application integration contract. The implementation does not inspect vendor shadow internals, copy vendor assets, intercept production fetches or change framework/router.

## Changes

- Pending decoration uses small HTML/CSS layout primitives and static bars/headings. Registering Polaris cannot restyle the skeleton. Loaded controls remain native Polaris.
- Products and Orders share a toolbar placeholder that reuses the real responsive search-container dimensions and known owner padding. Orders reserves the real minimum identity line height. These corrections reduce the handoff's vertical jump without guessing product text wrapping or result counts.
- The shared Preact readiness hook signals its own committed DOM in a short useLayoutEffect. Data fetching remains in ordinary effects.
- One coalesced animation-frame callback presents committed content after the data/runtime prerequisites. Duplicate notifications do not schedule multiple reveals. This is render coordination, not a claim that every optional asset is ready.
- Navigation retains the outgoing layout while making its controls inert. The destination document owns its loading shell. The old document no longer flashes its own skeleton before being replaced.
- Pagehide and persisted resume invalidate queued presentation. The current data prerequisite is checked again before reveal. Fresh authorization/revalidation and the existing stalled-runtime recovery remain required.
- The local preview retains the old heading with the old body until the incoming document commits. A bounded frame watcher and explicit reveal notification remove dependence on a later polling tick. Its regular polling remains for ongoing dynamic actions. This changes the local stand-in, not Shopify's host.

## Verification

The initial source regressions failed for immediate reveal, replacement of the outgoing page with its skeleton and delayed preview heading context. The corrected scheduler tests cover duplicate notification, inert outgoing actions, declarative children, stale callbacks and persisted history recovery. Existing real editor history tests retain their authentication and pending-write assertions.

Loading comparisons exercise actual Polaris registration and actual loaded Products/Orders, rather than accepting tag presence. Static route captures and browser transitions include desktop, phone, cached, cache-disabled and throttled cases. The final build passed, with 14 loading/scheduler checks and 11 affected navigation, history, list and recovery checks passing. Strict admin-test types, effective source coverage and scoped style checks passed, with one existing CSS warning for the hidden override.

The canonical matrix retains 126 cold/native/loaded captures with no overflow or browser errors. Eighteen final Products/Orders captures supersede the corresponding first-build captures. Twelve independent static route pairs were byte-identical across registration. The final independent delayed-navigation probe passed at 1440, 390 and 320 px, including inert body/host actions and heading/body agreement. Its [review receipt](/Users/pc/Development/Insignia/.artifacts/navigation-polish-2026-10-29/independent-review/review.txt) records the source and visual verdict. The local gallery's 530 images all returned successfully after refreshing the 36 loading images.

The first exact-PNG comparison also exposed nondeterministic one-channel antialiasing differences on rounded toolbar edges. Geometry and computed-color equality remain exact. Decoded-pixel comparison allows only a one-step channel difference, not displaced or missing UI. This is distinct from accepting a visible layout change.

## Limits

Late decorative SVG artwork can still appear after the first content frame. Its existing reserved dimensions prevent it moving surrounding content in the observed cases. There is no claim that every asset arrives simultaneously, nor a fixed minimum loading delay. Data-dependent row counts can differ from placeholder counts. Native embedded Shopify appearance, production network behavior and owner acceptance remain separate.

## Cross-page and order chronology follow-up

The owner's ordering observation was reproduced in the local examples. Orders, Home's authenticated read and the database already request newest first by actual creation time. The sample catalogues assigned older timestamps to higher order numbers, making a correct date sort look reversed. The demo and large catalogue now advance dates with their sample order numbers. Derived payment times remain after creation. Home scenarios now sort their recent-order records using raw ISO creation times before formatting the dates; their separate task queue retains its intended priority. This is fixture correction, not production sorting by order number.

A fresh browser check covered Home, Products, product configuration, Methods, method detail, Orders, order detail, Settings, App permissions, Billing and Storefront setup at 1440, 390 and 320 px. All 33 observations had the shared ready content visible and active, a plain-HTML placeholder tree, no document overflow and no browser errors. The visible default Orders rows match the date-desc API from #1049 to #1042. Explicit Oldest first still starts with #1042. Home's recent rows are descending too. Products and Methods are resource lists, not chronological order feeds, so no unrelated date sort was added.

Three chronology regressions first failed and then passed. Nine affected fixture/Home/export checks, four default/date-sort/cursor checks, strict types and the complete Home desktop/phone gallery passed. The refreshed full gallery still serves all 530 images. The scripts, screenshots and receipts are under `navigation-polish-2026-10-29/cross-page-ordering/` and the adjacent order-sorting logs.

Evidence directories:

- `/Users/pc/Development/Insignia/.artifacts/navigation-diagnosis-2026-10-29/` contains the original reproduction, research, red/green logs and build/check receipts.
- `/Users/pc/Development/Insignia/.artifacts/navigation-polish-2026-10-29/` contains rebuilt transitions and cold/native/loaded captures.
- `/Users/pc/Development/Insignia/.artifacts/navigation-loading-polish-2026-10-29/` contains the static-shell comparisons.
