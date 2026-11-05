# Luna Max cross-flow account and readiness audit

Date: 24 October 2026. Scope: account and runtime-readiness signals only where they cross into the actively designed Products, Methods, editor, buyer preview, and Orders work. This is a product/workflow audit, not a code-quality review. Standalone Settings, Billing, and Privacy page polish is out of scope for this pass.

## Finding

1. **P3 — The product editor can show “Active” beside an unqualified `unknown` Function readiness value.**

   **Task/repro:** Open an actively published product configuration and expand **Technical publication details**. The main publication status can say **Active**, while the detail says **Function readiness: unknown**. The page does not explain whether “unknown” is a live runtime limitation, a blocker, or a reason to stop using the configuration.

   **Evidence:** [MerchantConfigEditor](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L295) maps the main publication state to the merchant-facing **Active** label. The same component renders the raw `publication.functionReadiness` value inside its technical disclosure ([details](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L344)). The server-side Function observation is typed as `readiness: 'unknown'` because Shopify does not expose a deployed Wasm identity or a global propagation barrier ([FunctionOwnership](../../../packages/shopify/src/function-ownership.ts#L34)). The editor separately fails closed when publication eligibility cannot be verified ([save and eligibility recovery](../../../apps/web/src/islands/MerchantConfigEditor.tsx#L984)).

   **Impact:** A merchant may read “Active” as confirmation of the end-to-end runtime, then find “unknown” without a clear action or boundary. This weakens confidence in the product’s current behavior and can lead to unnecessary support contact or hesitation before continuing the setup flow.

   **Smallest fix:** Keep **Active** for the verified product publication state, but translate the runtime field into a plain, bounded explanation when it is unknown, such as: “Shopify does not expose a runtime version check here. Publication status above reflects this product’s saved configuration.” Do not imply that the runtime was independently verified or turn this into a store-wide dashboard. If there is no merchant action to take, say so.

   **Principle/scope:** Shopify’s content guidance favors task-led, specific language with enough context to choose an action ([content](https://shopify.dev/docs/apps/design/content)); its voice guidance says errors and status messages should explain impact and resolution ([voice and tone](https://shopify.dev/docs/apps/design/content/voice-and-tone)). Memorisely’s hierarchy walkthrough recommends grouping and prioritizing related information; Zander Whitehurst describes progressive disclosure as revealing detail as users need it ([Memorisely](https://www.linkedin.com/posts/memorisely_stop-ignoring-visual-hierarchy-in-ui-activity-7349029993810685953-wZK1), [Zander](https://www.linkedin.com/posts/zanderwhitehurst_ux-ui-uxdesign-activity-7163115739644698624-uqjX)). Keeping the technical detail collapsed is reasonable; the product judgment is that a raw `unknown` needs one sentence of meaning when opened. Checklist Design’s public catalog includes Settings, Empty State, and Showing input error checklists; it serves as a review prompt here, not a requirement to add account-management features ([catalog](https://www.checklist.design/)).

## What is working in this cross-flow slice

The editor separates draft edits from the last active publication, gives operational publication states plain labels, explains that the previous publication remains active while draft changes are publishing, and directs operator-held/conflicting publications to support instead of offering a risky retry. It also marks publication eligibility false when current readiness or a saved-draft refresh cannot be verified, and tells the merchant to reload before publishing. Those states make the actual product-level gate clearer than the raw runtime detail does.

## Coverage and limits

I read `AGENTS.md`, `README.md`, the implementation plan’s relevant setup/readiness sections, the admin UI guidance, and the active editor’s publication-state and eligibility handling. I used the local synthetic preview in an isolated tab, but it showed a settings skeleton and then “Interface unavailable — Reopen Insignia from Shopify Admin to try again.” I could not use that preview to verify the active Products/Methods/editor/buyer-preview/Orders flows or their visual states. The finding above is source-derived. I did not use a Shopify merchant account, change a product, publish, open/save a live theme, change billing, or operate a privacy request. Existing tests were read but not run; no tests were added. No owner draft or production store was changed; this file is the only audit artifact.

## Rejected recommendations

- Do not add a usage dashboard, multiple plan comparisons, revenue metrics, or a promotional landing page. Lean V1 has one recurring plan and explicitly excludes usage dashboards and multi-plan comparison ([implementation plan](../../../docs/architecture/implementation-plan.md#L678)).
- Do not treat a theme-editor link opening as proof that setup is complete; no readback contract exists.
- Do not label scope access as publication approval. The server enforces per-product publication eligibility, and the editor already fails closed when that check is uncertain.
