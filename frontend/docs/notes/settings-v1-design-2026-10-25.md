# Settings V1: access, billing and customer data requests

25 October 2026. Owner asked for a polished first version of neglected independent Settings pages, with simulated states and independent GPT-6.1 Sol product-design review before presentation. This is frontend presentation work. Existing authentication, billing, retention and export endpoints retain their authority.

## Decisions

App permissions separates product access, read-only checkout setup checks and per-product publication. Status and consequence sit together; the next action follows the result. Check access remains an explicit gesture. The existing readiness endpoint also inspects checkout functions, so optional checkout permission is needed before it can return product access. Missing permission now explains this dependency. Allow setup checks requests only the missing read scopes, once; a declined or uncertain request never silently broadens or repeats consent. Product publication remains a separate product task. Actual rendering caught an unrendered default-slot button group and an empty section body; supported inline actions and populated section content fix both.

Billing uses one subscription section. It groups confirmed status, actual recurring price, trial or billing dates, pending changes and the Shopify management action. A normal trial labels its price “Price after trial.” Development zero-dollar terms are explicitly separate from the standard USD 49.99 / 30-day plan. Inactive and unverifiable states explain available recovery without claiming paid access. Shopify owns plan selection and approval. The local management action opens an explicitly labeled local handoff, never a live charge workflow.

Privacy remains a separate operational page named Customer data requests. It contains a request inbox, due dates, selected request details, per-order exports and retained design downloads. That is enough work to justify a dedicated destination. It does not become an app-authored privacy policy, consent center or deletion panel. Shopify's native app details already owns its app-access disclosures. Native responsive table labels preserve Received, Due and Requested orders context on phone. Order groups disclose details progressively. Downloads say “Download started,” never that a customer received the data or a legal request was fulfilled. Transient failures retain clearly identified previously loaded context; authorization failures clear all private context. Request links support direct entry and modified clicks. Dates retain an explicit UTC fallback because these endpoint views do not supply an authenticated store timezone.

The Settings hub changes only the privacy destination name/description. Home, onboarding, other preference screens and backend integration remain outside this slice.

## Sources and how they were applied

- [Shopify Settings template](https://shopify.dev/docs/api/app-home/latest/patterns/templates/settings): logical sections, concise context, status/action grouping. No Save Bar for observation-only pages.
- [Shopify account connection](https://shopify.dev/docs/api/app-home/latest/patterns/compositions/account-connection): compact account state and contextual next action.
- [Shopify details template](https://shopify.dev/docs/api/app-home/v2.0/patterns/templates/details), [table](https://shopify.dev/docs/api/app-home/v2.0/web-components/layout-and-structure/table) and [section](https://shopify.dev/docs/api/app-home/v2.0/web-components/layout-and-structure/section): request list/detail framing and native responsive composition.
- [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) and [Managing apps](https://help.shopify.com/en/manual/apps/managing-apps): Shopify manages plans; current terms, trials, billing periods and pending changes belong together. Existing commercial policy is preserved, not inferred from general design advice.
- [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md): focus, accessible actions, narrow layouts, error recovery and semantic appearance. Muted Billing text uses supported Polaris color roles.
- [Memorisely hierarchy example](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1): grouping, proximity, alignment and priority inform the shared layout. This is general instruction, not Shopify billing/privacy policy.
- [Zander Whitehurst disclosure example](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX): reveal per-order details when useful and keep recovery reachable. Existing recorded Checklist Design principles supplement the review; no newly fetched Checklist rule is claimed.

Read-only native reference: Shopify Admin > Settings > Apps > Insignia SuperFunny. Observed app identity/status, activity/permissions, unused access and privacy data disclosures. This custom app had no paid billing card, so it does not establish exact paid Billing composition. No native plan, permission, store or theme mutation occurred.

## Validation and review

- Official Shopify toolkit validates generated components against pinned Polaris 2.0-rc, matching runtime and types.
- Web build checks 147 files without errors/warnings; strict admin-test compilation and scoped Biome pass. Source-contract coverage passes.
- Focused Billing, Privacy, settings/navigation, consent, denied-access and selected-request regressions pass. Existing tests now target real request links and expandable order groups. A failed request switch retains its visibly identified previous request; denial still clears it.
- Opt-in Settings gallery checks 24 states at desktop 1440×1000 and phone 390×844, with 320×568 overflow assertions. Live local scenario controls are outside the product UI and excluded from captures. The full gallery keeps prior evidence and filters the 24 Settings states first.
- Independent GPT-6.1 Sol medium reviewer inspected final source and 18 representative screenshots. Verdict: ready for owner presentation, no blocking product-design findings. Its phone-count labeling comment was fixed and recaptured. Trial price labeling was clarified in the final pass.

These results establish application-source and local synthetic UI behavior. They do not establish production deployment, native consent or charge acceptance, dark Shopify appearance, human usability, owner visual acceptance or release approval.
