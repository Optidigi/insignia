# Native screen parity: selected admin screens

**Observed:** 8 November 2026. **Coverage:** Home, Orders list/detail, Settings/Billing/Permissions/Translations. This is a read-only visual and DOM comparison, not a full workflow or persistence qualification.

The comparison used the Shopify admin app and the isolated selected-UI demo at `http://127.0.0.1:62171`. The native image (`76d5d0f9`, started at 20:24:30Z) and demo source (`4a9cb951`) are identities supplied by the QA coordinator; I did not independently fingerprint the running artifacts. Both screenshots were captured at a 2560 × 1267 browser viewport. The embedded app content widths are unequal: native content is offset by Shopify navigation, while the demo uses its own centered preview. Measurements below are approximate screenshot pixels and are not a pixel-parity claim.

No store data was changed. I did not edit translations, request or grant access, alter billing, or invoke order actions.

## Findings

- **Settings overview:** The native page includes Preferences and a Privacy row. The local fixture hides Privacy because its capability is false. Preferences is present natively; `body.innerText` alone is not a reliable check for Shopify Polaris shadow-DOM content. The native Settings card is approximately 786 px wide. These differences do not establish a selected-UI regression.
- **Billing:** Both sides show the Insignia Standard plan and development test terms. The native state is `Subscription active`, USD 0.00 per 30 days, with a 31 Oct–30 Nov 2026 period. The local `development` example is `Trial active`, USD 0.00, and says the trial ends 8 Nov 2026. This is a fixture/state mismatch, not a visual defect. The structures are comparable.
- **Permissions:** Both pages start at `Not checked`. Using only the read-only Check access control, both reached the same visible allowed/edit-capability summary. The native flow did not request or grant access. Layouts are close; native card width is approximately 786 px.
- **Translations:** After one native Try again, the overview loaded. The three `Unavailable` category labels are present in both native and local initial fixture; the missing group labels are already tracked as QA-005. No translation was changed. Native panel width is approximately 838 px.
- **Orders list/detail:** Native displayed five test orders (#1005–#1001); the local sample displayed eight synthetic orders (#1049–#1042). The column structure is comparable, but the records, count, and currency differ. I opened the native test order #1005 and the closest local example #1048 to compare detail composition. Native shows one item, paid, artwork complete, a front demo placement, and a 14 Nov 2026 download-retention warning. The local example has different product/placement facts and no matching retention deadline. No download, replacement, or other order action was taken. The Shopify sidebar also makes the native table content area narrower than the demo.
- **Home:** The panel structure and 0/3 guide progress are comparable. Native showed 0 orders / 0 customized items for the last 30 days, five test orders, and one draft; the local operating-default fixture showed 43 orders / 151 items, five different synthetic recent orders, and one draft. The local synthetic data is not a native data oracle, so the count difference is not classified as a defect. Home content widths were approximately 968 px native and wider in the demo.

The only observed transient failure in this bounded run was the native Translations overview initially showing a load error; its read-only retry recovered. Intermittent native read failures remain tracked under QA-002. Host chrome, the local preview controls, fixture record differences, and capability-specific Privacy visibility are excluded from UI regression claims.

## Evidence

Paired screenshots are full-browser captures at the viewport above. They show the actual rendered screen; native accessibility inspection was also used because some Polaris labels are omitted from `body.innerText`.

| Surface | Native | Isolated demo |
|---|---|---|
| Settings | [native-settings.jpg](../evidence/frontend-qa-2026-11-08/native-settings.jpg) | [demo-settings.jpg](../evidence/frontend-qa-2026-11-08/demo-settings.jpg) |
| Billing | [native-billing.jpg](../evidence/frontend-qa-2026-11-08/native-billing.jpg) | [demo-billing.jpg](../evidence/frontend-qa-2026-11-08/demo-billing.jpg) |
| Permissions | [native-permissions.jpg](../evidence/frontend-qa-2026-11-08/native-permissions.jpg) | [demo-permissions.jpg](../evidence/frontend-qa-2026-11-08/demo-permissions.jpg) |
| Translations | [native-translations.jpg](../evidence/frontend-qa-2026-11-08/native-translations.jpg) | [demo-translations.jpg](../evidence/frontend-qa-2026-11-08/demo-translations.jpg) |
| Orders list | [native-orders-list.jpg](../evidence/frontend-qa-2026-11-08/native-orders-list.jpg) | [demo-orders-list.jpg](../evidence/frontend-qa-2026-11-08/demo-orders-list.jpg) |
| Order detail | [native-order-detail.jpg](../evidence/frontend-qa-2026-11-08/native-order-detail.jpg) | [demo-order-detail.jpg](../evidence/frontend-qa-2026-11-08/demo-order-detail.jpg) |
| Home | [native-home.jpg](../evidence/frontend-qa-2026-11-08/native-home.jpg) | [demo-home.jpg](../evidence/frontend-qa-2026-11-08/demo-home.jpg) |

## Limits

This run did not qualify data correctness, request durability, save/publish/upload behavior, all responsive breakpoints, or all locale variants. Orders and Home used different fixtures and should not be compared as data parity. The open modal lifecycle fix is not deployed in the observed native image; this screen pass does not cover Add views or any upload path. Add views is audited separately in [add-views-parity.md](add-views-parity.md).
