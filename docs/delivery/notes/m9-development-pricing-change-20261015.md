# M9 development pricing change assessment — 15 October 2026

Read-only primary-source research. No authenticated API/browser/session access, plan edit, subscription selection, migration, pricing-method switch, event submission or token acquisition occurred in this task. This is a prospective proposal, not an execution grant or native qualification.

## Newly supplied observation and its limits

The owner opened the historical private-plan editor for exact app `429028933633`, plan `insignia-dev-zero-20260928`. Reported fields: private, one authorized rewrite-dev store, subscription preview `$0/month`, and one fixed-rate `customized_order_paid` meter at `$0.01/unit`. The banner says the plan goes live to merchants when switching from manual pricing to Shopify App Pricing. This is owner-reported editor evidence; it does not prove that saving an edit updates an already-selected development contract. The previously read development subscription remains separate dated evidence.

The [current official migration guide](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/migrating-to-shopify-app-pricing) says `activeSubscription` now returns both Billing API and App Pricing subscriptions. Consequently an active-subscription response alone does not establish the app's global pricing method; the editor banner and contract identity must be reconciled before any mode change is considered. This task authorizes no switch.

## What can be prepared before switching

Shopify expressly supports preparing and testing App Pricing draft plans before switching. Preparation does not change existing live plans/subscriptions. Its sequence includes reviewing plan terms/store targets, adding missing plans, subscribing to a draft on a same-organization development store, approving its redirect, checking current subscription, and separately testing usage. Enabling App Pricing and migrating existing subscriptions are later distinct operations. [Migration guide](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/migrating-to-shopify-app-pricing).

The [official July preparation announcement](https://shopify.dev/changelog/blog/prepare-your-app-for-migration-to-shopify-app-pricing) explicitly includes both public/private drafts, editing existing drafts or creating additional plans, and testing on an owned same-organization development store without migrating shops or subscriptions. Therefore neither a public listing submission nor an app-wide switch is established as necessary for this development test. Actual editor availability/save behavior must still be observed.

## Reuse versus a separate private draft

| Option | Benefit | Material limitation |
| --- | --- | --- |
| Edit `insignia-dev-zero-20260928` | Fewest plan records; owner already found its editor. | Overloads a historical fixture handle with different economics. No inspected official contract establishes whether saving changed terms on a reused App Pricing handle automatically affects this existing selected development subscription. Do not promise either propagation or grandfathering. Saving and then assuming the existing contract changed would be insufficient proof. |
| One separate private draft representing the approved commercial plan | Preserves the historical fixture; gives the prospective economics an explicit handle and explicit store selection. | Adds one provider configuration record and a later subscription approval. It must be scoped to the existing rewrite-dev store and must not become another product, permanent demo tier, public plan or rollout. Existing plan and trial history are retained. |

Recommendation: first inspect whether a candidate with the approved terms already exists; reuse such a candidate if exact. If absent, prefer **one separate private draft of the approved single plan**, rather than silently repurposing the historical zero fixture. This is an engineering recommendation to separate prospective configuration from historical evidence, not a Shopify requirement to create a new plan. [Private-plan configuration supports explicit store access](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans). Do not create duplicates to obtain fresh trials or evade store protections.

No official source located in this bounded research settles propagation of edits to an already-selected App Pricing contract. Community reports of retained old tiers are useful hypotheses, not adopted guarantees. The prospective test must compare independent pre/post `activeSubscription` contract items and `pendingUpdate`, rather than infer changed terms from an editor Save or identical handle.

## Exact proposed draft and observable acceptance

The [locked commercial decision](../authority/commercial-single-plan-2026-10-10.md) and [implementation plan](../../architecture/implementation-plan.md) require USD49.99 per30-day cycle,100 qualifying paid customized orders included, then USD0.10 each, with14 trial days and no subscription/usage charge during trial.

- One private draft, existing app only: proposed handle `insignia-standard-20261015`, proposed invoice/display name `Insignia Standard`. These are proposed candidate fields, not claimed provider facts; verify availability and actual saved identity. It represents the approved single plan under development, not an additional commercial offering.
- Recurring USD49.99; monthly UI selection must be checked against the actual provider cycle and the locked30-day contract before claiming equivalence.
- One `customized_order_paid` **graduated** meter: units1–100 atUSD0/unit, units101 onward atUSD0.10/unit; no additional flat tier amount. Keep one counted unit per qualifying order, not quantity. Shopify documents graduated charges as the sum across tiers; volume applies a chosen tier rate to the whole quantity and is wrong for this allowance. [Usage pricing structures and combined recurring/usage support](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-usage-charges).
- Free-trial duration14. Preserve any existing welcome link/settings unless an exact required redirect correction is separately reviewed.
- Only `insignia-rewrite-dev.myshopify.com` has access; leave any broader other-Partner/developer testing option off. Verify development-store status and same Partner organization before any later subscription confirmation. No public plan, other store, discount, extension, app version, scope or reinstall.

Shopify documents that same-organization development stores can select available paid plans at no charge and that effective recurring/usage subscription prices become zero. Therefore zero-priced returned items do **not** prove absence of configured commercial rates; retain separate draft/editor terms and provider subscription evidence. A zero-price development test can qualify identity, selection, meters and lifecycle, but cannot prove real-price invoice math. [No-charge development testing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing#testing).

## Trial qualification

Shopify tracks consumed trial days over180days; changing the configured duration subtracts previously consumed days. Reinstall is not a legitimate reset. Configuring14 does not guarantee this existing store receives a fresh14days. Verify actual authoritative `trialEndsAt` and the activation/history before claiming trial acceptance. Whether a different handle shares the prior trial consumption is not settled by the inspected guide; do not assume isolation. [Trial proration](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/offer-free-trials#trial-proration).

The same guide describes trial extensions as a separate permissioned action that sends merchant email and automatically changes the subscription. No extension is included. If the store cannot expose a full fresh trial under actual history, report that native limit; preserve local trial-waiver tests and provider facts rather than invent timestamps or change the promise.

## Smallest prospective grant, conditional on the actual candidate

Prepare one reviewable candidate before asking. The first proposed grant, conditional on finding no exact existing candidate, is **draft creation only**: create/save one private App Pricing draft on app429028933633 with the fields above and only existing rewrite-dev store access; independently verify persisted settings. No subscription selection or confirmation is included. No public publication, pricing-method switch, subscription migration, real charge, new store/product, uninstall, event send, token acquisition or runtime billing enablement follows.

A subsequent distinct proposal can cover selecting/approving that exact saved draft on the existing same-organization development installation, only after independently inspecting an actual zero-effective-price approval preview. It must record resulting contract, trial, pending-update and history evidence. Do not request or exercise it as an implicit consequence of draft creation. Preserve the configured14-day trial; no shorter trial, new store or reinstall is proposed to manufacture a result.

The root observed HTTP422 when opening the exact historical existing-plan editor URL; no Add control was observed. This task has not reproduced it and no supported CLI catalog-write route is established. If the owner browser is the only supported available route, the lead should provide the concrete draft-only fields and ask only for that necessary human operation after the bounded grant. Approved economics alone do not authorize the provider write.

If the actual UI cannot save/test the draft without switching mode, migrating, widening store access or charging, stop before that effect and report the exact constraint. Do not widen the proposal automatically. Preserve before/after identifiers and outcome; do not retry an ambiguous save or subscription confirmation. The explicit dev subscription change is distinct from pricing configuration and from later bounded usage-event qualification.

## Disabled private Add follow-up

The owner subsequently reached the pricing index: Private plans Add is grey/unresponsive, Public plans Add is enabled, and the banner marks draft/testing as current with App Pricing activation not started. This is a concrete availability limit for the granted **one private draft only** operation; general documentation does not prove that this particular UI control works.

A bounded search of official documentation and first-hand Shopify developer threads found **no documented rule explaining exactly this private-Add-disabled/public-Add-enabled combination**. Quota, migration stage, permissions, or a required prior public plan remain unverified hypotheses. Current [official plans documentation](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans) allows unlimited private plans and specifies an eight-private-plan access limit per store; that is not an explanation for disabling creation here. Shopify's [September22 announcement](https://community.shopify.dev/t/shopify-app-pricing-now-supports-unlimited-private-plans-and-stores/37883) says the earlier private-plan/store caps were removed. Its [September29 migration announcement](https://community.shopify.dev/t/shopify-app-pricing-migration-tooling-for-existing-billing-api-subscriptions-is-now-available/38114) reiterates preparing/testing plans before switching. None identifies a new public-plan prerequisite.

The existing historical plan editor remains a readable alternative for inventory, **not an authorized edit alternative**: the current grant preserves that plan. Editing its economics would require a concrete replacement grant and an explicit assessment of the unresolved existing-contract effects above. Creating a public plan, activating App Pricing, migrating subscriptions, deleting plans to reset a quota, constructing an undocumented create URL, or force-clicking a disabled control is not justified. A supported reason exposed by the normal UI, or a legitimate supported private-create route, would resolve this specific blocker; this research establishes neither and authorizes no support contact.
