# Home refinement independent review

26 October 2026. Independent source/state review of the Home refinement in the local application. I inspected fresh local PNGs at 1440, 390 and 320 px. The corrected final captures close the disclosure finding below. This is not native Shopify, owner or release approval.

## Review basis

I read the repository entry, admin UI guidance, saved UI delivery workflow, Home V1 design note and prior independent review. The review uses the installed Checklist Design Dashboard and Onboarding checklists, Shopify App Home guidance for the selected Polaris 2.0 RC runtime, and freshly fetched Vercel Web Interface Guidelines. Shopify remains the component and copy authority.

The official toolkit searched the selected `2.0-rc` contract for metrics and setup-guide compositions. Its metrics result resolves to the official v2.0 composition. The public metrics example uses a responsive group of app-specific numbers; historical comparisons justify trend badges. Insignia has no comparison source here, so trends and revenue are omitted. This review does not require a new analytics endpoint or persistence backend.

Sources: [Shopify metrics composition](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/metrics-card), [Dashboard checklist](https://www.checklist.design/web-app/dashboard), [Onboarding checklist](https://www.checklist.design/web-app/onboarding), [Vercel guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

## Source checks

No material source/truth finding remains in the reviewed implementation. `homeStatisticsFromResponse` requires a complete purchase collection and omits statistics when another page exists. It filters a single 30-calendar-day period in the store time zone, excludes known test and cancelled orders, and withholds results when an in-period test flag is unknown. Orders, original item quantity and distinct purchased product IDs all use the same cohort. An incomplete recent page never becomes a total or a verified zero. The explicit preview numbers are synthetic period facts.

`hasMore` preserves the recent-list bound. Supported artwork interventions are separate model facts, with their own bounded rendering and optional authoritative total. The live DTO cannot supply precise recovery reasons, so the adapter supplies no invented attention queue. This is a documented production limitation, not evidence of a complete queue. The older-work fixture puts order #1043 in Artwork to prepare even though it is absent from the five recent rows. The many-task fixture shows 3 of 8 and retains View all orders.

Getting started is educational. Its dismissal changes only a versioned browser-local shop key; the helper catches unavailable storage and rejects absent or malformed shop context. It stores no user identity or setup fact. Restoration removes the same preference. Storefront setup, actual artwork tasks and read failures remain separate. The source does not claim staff isolation, synchronized preferences, completed theme work or a successful customer test from dismissal.

## Rendered findings

The operating composition preserves V1's compact resource groups. Last 30 days is actually visible beside Customization activity, including at 320 px. The three metric columns fit with labels and values intact. The exclusion note stays beside those values; the one About these numbers disclosure holds definitions and calendar-day semantics. Its popover fits 1440, 390 and 320 px without clipping.

The older-work captures retain #1043 and its reason above the five explicitly bounded recent rows. The many-task capture clearly says Showing 3 of 8 orders that need artwork. Narrow task actions stay with their reasons, and the draft thumbnail keeps a fixed track so its title can wrap. Unavailable statistics remain local while orders and drafts stay visible. Loading uses neutral skeleton shapes rather than zero values.

The initial 390 and 320 px Getting started headers placed Show guide or Hide guide inside native ellipsis overflow, while the dismissal x stayed visible. This made the main disclosure less obvious and the parent's keyboard test caught the unavailable direct restore target. The final correction places a visible Show guide control in the card body and Hide guide beside the storefront action after the expanded content. I reopened the final 19:31 narrow expanded and mobile first-visit captures. The direct controls are visible, the bullets start at the normal inset and no ellipsis hides the disclosure. This finding is resolved.

The dismissed captures remove the intro card and retain Show getting started after current work. The first-visit capture retains both the older artwork task and separate pending Storefront setup. These pixels establish visible distinctions; the parent owns the executed dismissal, persisted-revisit and keyboard checks.

## Dashboard checklist

Audited against [Dashboard, Web app](https://www.checklist.design/web-app/dashboard).

| | Item | Why |
|---|---|---|
| 🟡 | Welcome state | Current work orients the merchant; there is no source for changes since the last visit. |
| 🟢 | Key metrics | Period and definitions are visible or disclosed. Live totals require a complete source, while preview totals are explicit fixtures. |
| 🟢 | Recent activity | Order identity, date, product, status and the recent bound stay together. |
| 🟡 | Needs attention | Independent supported-task fixtures preserve older work. The live adapter cannot derive a complete queue from its existing DTO. |
| 🟢 | Quick actions | Resource and setup actions retain concrete destinations. |
| 🟢 | Empty state | First product setup, no orders, failed reads and unavailable statistics remain different states. |
| ⚪ | Layout control | This small overview needs no widget editor; the educational introduction can be dismissed and restored. |

## Onboarding checklist

Audited against [Onboarding, Web app](https://www.checklist.design/web-app/onboarding).

| | Item | Why |
|---|---|---|
| ⚪ | Progress indicator | Independent product, theme and test work has no invented percentage. |
| 🟢 | Welcome message | The guide explains the product, theme and customer flow in three concrete steps. |
| ⚪ | Account setup | Shopify owns authenticated store context. |
| 🟢 | Product highlights | The corrected guide has visible disclosure, dismissal and restoration controls. |
| 🟢 | First action prompt | Product setup and the actual storefront handoff remain concrete. |
| ⚪ | Completion confirmation | Guide dismissal does not establish setup or test completion. |

## Evidence and limits

I opened operating desktop/mobile; expanded guide desktop/mobile/narrow; dismissed guide mobile/narrow; first-visit mobile; older artwork work desktop/narrow; many artwork tasks narrow; statistics definitions desktop/mobile/narrow; statistics loading desktop; and statistics unavailable mobile/narrow from the 19:22 capture batch under `/Users/pc/Development/Insignia/.artifacts/admin-popup-review-2026-10-24/home/`.

No browser session, Shopify store or application state was changed by this review. Source and static images do not prove keyboard behavior, persistence in an embedded host, dark-host appearance or owner acceptance. Parent-run behavior checks are recorded separately. The parent reports all 81 final captures and the full interaction test pass, including persistence and visible keyboard focus after restoration at 320 px. I did not operate those tests. I reopened the final operating desktop/mobile captures and verified five rows with the explicit Showing the 5 most recent customized orders caption. No unresolved material source or visual finding remains within this local review scope.
