# Independent handoff review — 2026-10-30

Read-only audit of the localization plan, first-product guidance recommendation, and customer/merchant UI handoff. No app code, dependencies, service state, or screenshots were changed. No tests were run.

## Checkout safety

The backend checkout is a separate, clean detached worktree at `54c222ba` (`origin/main`). It is an ancestor of `56ab3420` in the UI checkout; the UI branch is ten commits ahead. The UI checkout is also the primary workspace and had 486 dirty entries before this review note was added. No fetch, install, checkout, or branch mutation was needed. A backend handoff made from the clean checkout alone would omit both the ten UI commits and the uncommitted design work.

## Localization plan

The i18next-core/native-Preact direction fits the actual frameworks: the merchant app pins Astro 7 + Preact 10, while the selected customer project is a separate Vite + Preact 10 checkout. The plan already protects the major correctness boundaries: request-scoped SSR instances, equal server/client locale resources, Shopify-owned locale precedence, stable domain/error state, safe text rendering, catalogue completeness, and a separate later RTL review.

Three decisions should be explicit before implementation:

1. **Resolve shared-source distribution, not just package placement.** `packages/*` is the monorepo workspace, but `designer-prototype` is a separate project with no shared workspace dependency today. The plan correctly flags this as a pre-implementation check; make the outcome a handoff decision (one versioned/source-of-truth catalogue and a supported import/build route) before adding the package. Do not make local relative paths or duplicated catalogs the implicit contract.
2. **Name the exact translation surface.** The intended scope appears to be merchant Astro/Preact, the selected sibling customizer, and Shopify theme-extension locale files. State explicitly whether the unselected `apps/storefront` integration UI is out of scope; “whole frontend” could be read more broadly by a future agent.
3. **Include the Astro shell and document metadata in ownership.** [AdminLayout.astro](../../../apps/web/src/layouts/AdminLayout.astro) owns static SSR text and `<html lang="en">`, plus the pre-island skeleton/failure UI. Those strings and the resolved document `lang` must follow the same locale/readiness contract as Preact islands. Current code gets Shopify locale from browser-side App Bridge in components such as [MerchantHomeContainer.tsx](../../../apps/web/src/islands/MerchantHomeContainer.tsx); the plan's “resolve before revealing” rule is the right mechanism, but should explicitly cover shell strings and document language.

For agent maintenance, the plan's strongest rule is its own extraction step: the standard CLI does not parse Astro or Liquid merely because paths are included. Keep an enforced extractor/linter for the actual translation helper, Astro templates, theme locale files, and Polaris custom-element text/accessibility properties; also define who reviews catalog additions. The proposed complete-screen migration order is reviewable, provided it does not make `apps/storefront` or local preview fixtures accidental translation targets.

## First-product guidance

**The no-new-wizard conclusion is sound, but the evidence should distinguish the selected UI from production UI.** The selected polished product editor is [placement-workflow-preview.tsx](../../../apps/web/test/admin/support/placement-workflow-preview.tsx), served by the local admin preview. Its first-product path is contextual: “Add your first product view” → “Add placement” → “Draw area” → “Choose methods,” with pricing and setup cues next to the relevant placement controls. It has a direct Publish action in the preview, not a “Step n of 4” / “Review and publish” wizard.

Those four named sections and “Step n of 4” belong to the separate production [MerchantConfigEditor.tsx](../../../apps/web/src/islands/MerchantConfigEditor.tsx). The [first-product research note](first-product-guidance-research-2026-10-30.md) describes both, but currently risks using production editor steps as evidence for the selected polished editor. Keep its recommendation, and clarify that the selected UI's inline prompts provide the next action without a wizard; don't attribute the production editor's step navigation to the selected design.

There is a real skip path for the Home guide: it can be dismissed and later restored. The selected editor itself is not a blocking tour and does not impose a linear sequence; “All settings” belongs to the separate production editor and is not evidence about the selected design. Also retain the completion caveat: the Home guide's “Setup guide complete” / “3 of 3 complete” comes from manually acknowledged, shop-local checkboxes, not verified product publication, theme setup, or a successful test. The research note notices this, but handoff copy should not present those checks as authoritative configuration state. Actual test readiness is separately gated on published product and setup facts.

The local first-product browser flow uses synthetic fixtures. Its evidence supports transitions and copy only; it does not prove Shopify persistence or publish completion.

## UI handoff and cleanup boundary

The polished UI the user may want to hand to the backend developer is currently under `apps/web/test/admin/support`, and the root README explicitly says the local demo is isolated from production. Give the developer the UI branch/diff plus the specific source mapping, and label local screenshots as fixture previews:

| Design to carry forward | Production landing point | Preview-only seam to keep out of production |
| --- | --- | --- |
| Product placement editor: `support/placement-workflow-preview.tsx`, its canvas/image-picker/method/variant-photo components and CSS | [MerchantConfigEditor.tsx](../../../apps/web/src/islands/MerchantConfigEditor.tsx) and its existing product route/API contracts | Synthetic placement model/fixtures, browser-local persistence, preview publication, and localhost customer-preview launcher |
| Methods index and editor: `support/method-index.tsx`, `support/method-workflow-preview.tsx` and their styles | [MethodLibrary.tsx](../../../apps/web/src/islands/MethodLibrary.tsx) and [methods.astro](../../../apps/web/src/pages/admin/methods.astro) | Synthetic catalogs, demo transports, and tab-local fake persistence |
| Home first-use presentation | Already represented in [MerchantHome.tsx](../../../apps/web/src/islands/MerchantHome.tsx), [HomeGettingStarted.tsx](../../../apps/web/src/components/HomeGettingStarted.tsx), and the real container | `home-preview.tsx` plus fixture-driven preview host behavior |

Port selected presentation into production-owned islands/components while retaining real authenticated APIs, DTOs, persistence, and workflow state. The demo editor's `PlacementProduct` and simulated publish/cart state are not backend contracts and should not be imported as such.

If the merchant demo is later retired, the removable unit is its dedicated `dev:admin` entry, `apps/web/test/admin/preview.mts` composition/server/injection, and support modules/tests that are reachable only from that host. Keep production `apps/web/src`, production API/browser tests, and shared test helpers still used by those tests. In particular, do not delete all of `test/admin/support`: it mixes polished preview UI and synthetic demo modules with reusable browser/runtime test support. The existing README already describes the demo-only boundary and says the real admin routes remain.

## Sources inspected

- [Localization implementation plan](localization-implementation-plan-2026-10-30.md), [translation options review](translation-options-independent-2026-10-30.md), and [Astro follow-up](astro-translation-options-2026-10-30.md).
- [First-product guidance research](first-product-guidance-research-2026-10-30.md) and current Home/product-editor source.
- [Frontend demo separation research](frontend-demo-separation-research-2026-10-30.md), root [README](../../../README.md), [package scripts](../../../package.json), and local preview entry/support modules.
