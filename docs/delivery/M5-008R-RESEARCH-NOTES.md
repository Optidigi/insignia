# M5-008R — public contract and observation provenance

Public Shopify documentation read on 2 October 2026 UTC:

1. [Deployment workflow](https://shopify.dev/docs/apps/launch/deployment/deploy-app-versions): Dev Dashboard Versions → Create a version → Release → final Release confirmation is the documented combined configuration creation/release flow. This corrects the older staging procedure; it does not satisfy the installation gate.
2. [Version contents](https://shopify.dev/docs/apps/launch/deployment/app-versions): the Dev Dashboard version-create page carries configuration on the page plus extensions in the current active version. The principal accepts this route as the slice's preservation mechanism. No extension manifest or new version inheritance was observed in this stopped slice.
3. [Metrics and current installations](https://shopify.dev/docs/apps/build/dev-dashboard/monitoring-and-logs): install/uninstall events concern the selected date range. The documented current Installs count is a separate upper-right metric; selecting it opens Current installs. Documentation says this metric includes dev stores and installations with no active plan.

The actual authenticated exact-app Overview exposed event charts and Distribution, but no current Installs count/list control in rendered text, interactive controls or focused header/aside/label inspection. This discrepancy is an observation, not evidence that the public contract is false, the current count is zero, another store is installed, or a particular permission is absent. The reported browser import-map error has unknown causal relevance. No replacement route was executed.

Primary authority remains the owner-forwarded [M5-008R brief](prompts/M5-008R-COMBINED-RELEASE-AND-GRANT-VERIFICATION.md) and [external PR-036 verdict](PR-036-principal-review.md). Public docs explain platform contracts; they do not expand this slice's authorization.
