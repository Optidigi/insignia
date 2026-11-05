# Prompt for an independent review of the Insignia UI work

Assess how this UI work has progressed and propose a working method for the next iteration. The owner reports that progress has taken too long and that they have repeatedly had to identify details they expected the agent to handle. Determine the causes from the conversation, code, rendered pages and source material. Keep the possible causes open until you have examined the evidence.

This handover records the preceding work. Its explanations and the earlier agent's notes are evidence to check, not conclusions to adopt. Deliver your assessment and a concrete next step before making application changes.

## Work in this order

1. Read the originating chat. Identify the owner's requirements, subsequent corrections, the agent's responses, and the verification actually performed. Finish with a short chronology that distinguishes user observations, agent claims and tool results. State any gaps in the history you could access.
2. Inspect the current checkout and the relevant project instructions. Follow the source pointers below for the part you are examining. Establish which reported problems still exist and which describe earlier revisions. Finish with a reproducible account of the current overview and detail pages.
3. Compare representative interactions with the actual Shopify pages in Chrome, if those tabs remain accessible. Examine the corresponding official documentation, skill instructions and validation behavior. Follow at least one overview issue and one detail issue through requirement, source consulted, implementation, verification and owner feedback. Finish with evidence for any diagnosis, including evidence that limits it.
4. Recommend a source hierarchy and a short implementation and review loop. Explain what each retained tool establishes, what it does not establish, and when to use it. Finish with a bounded next iteration and observable completion criteria.

## Read the originating chat

The Codex chat is **Prepare Insignia admin UI guidance**.

- Thread ID: `01a15681-08c3-7fb1-84d0-0814188422f0`
- Host ID: `local`
- Project directory: `/Users/pc/Development/Insignia`

The Codex app's `read_thread` tool was verified to access this chat during handover. Start with this request, using the tool name exposed in your session:

```json
{
  "threadId": "01a15681-08c3-7fb1-84d0-0814188422f0",
  "hostId": "local",
  "turnLimit": 1,
  "includeOutputs": false,
  "maxOutputCharsPerItem": 4000
}
```

Read older turns using each response's `page.nextCursor` as `cursor`. Continue through the initial repository and UI preparation requests. Inspect particular tool outputs when needed to verify a claim. A returned summary or truncated output is partial evidence. Record that limit if it prevents checking a material point. A fork of this chat is another way to inherit its history; creating a separate chat is an owner action unless separately requested.

## Owner requirements and feedback

These summarize the owner's messages. Check the original wording and sequence in the chat.

- Work locally on the latest Optidigi/Insignia code, on a branch covering both merchant admin and customer-facing UI. The current implementation work has focused on the admin.
- Use Astro and Preact with Polaris 2.0 web components. Initially make Shopify guidance, its AI Toolkit, skills and MCP the primary sources. Use Vercel, Matt Pocock and checklist.design as supplementary material. Keep copy concise and appropriate to Shopify admin.
- Inventory the existing admin's capabilities and endpoints. Its existing visual design was explicitly excluded as inspiration.
- Start with the Orders overview, adapting Shopify's order experience to Insignia. Later include the order detail page and its available data and states.
- After the first implementation, the owner said it differed substantially from Shopify and requested inspection of the actual Orders page open in Google Chrome.
- Subsequent feedback covered icon rendering and glyph choice, dates, fonts and weight, loading states, whole-row click targets, hover, sorting, filtering and edge cases.
- Seven browser annotations identified differences in Display options, search, the All disclosure icon, payment status icon, the Date header control, button shadows, and an extra result-count line and pagination treatment.
- Further feedback identified an oversized Date arrow, mismatched hover and inconsistent sorting affordances across headers. The owner asked whether the sources contradicted each other or were insufficient, and whether to continue pursuing the Shopify appearance.
- The owner then authorized a robust approximation using supported components, with difficult low-value features eligible for omission. They objected to Test tags beside order numbers and an unexplained number under Customized items.
- The owner requested selection for eventual bulk production printing, leaving implementation timing to the agent. They also requested a better detail page without unnecessary invented functionality.
- The latest implementation feedback concerned odd search behavior, exposed GIDs and configuration references, Next step copy, routine customization-expiry information, and inadequate examples of orders containing multiple customized products and sizes.
- The owner has repeatedly requested minimal relevant testing and efficient iteration. They authorized Luna 6 extra-high subagents and limited use of Sol 6.1 medium for harder work.
- The current request asks for an independent assessment, including reconsideration of tools, their use, and the primary design source. It does not establish a cause for the problems.

## Checkout and current implementation

Snapshot on 20 October 2026:

- Repository: `/Users/pc/Development/Insignia/insignia`
- Branch: `codex/ui-redesign`
- HEAD: `56ab3420`, `Simplify order workflows and qualify multi-product previews`
- Working tree was clean before this handover document was added.
- These local UI changes have not been pushed or deployed. Owner visual acceptance and qualification of this implementation inside Shopify in both appearances remain outstanding.

Read `git log` and inspect the current code rather than treating this snapshot as permanent. Recent commits also include `7fe2e4c9`, `a2c581f8`, `1c4546ba`, `ada18473` and `61e3c83b`.

The app is an Astro/Preact iframe App Home. It uses the public `s-*` Polaris components and a Polaris 2.0 release-candidate runtime, rather than a Shopify-hosted admin extension. Read exact runtime and type pins from the source.

The overview currently has Order, Date, Total, Payment status, Artwork status and Items columns. It uses a real order link with whole-row delegation, relative dates, loading and recovery states, column visibility, date sorting and date filtering. Date queries operate across the collection; text search and artwork filtering operate on the loaded page and disclose that scope. Pagination appears when needed. The latest pass removed the Date-only header imitation and custom column reordering. Test status appears on the detail page. Item counts include their unit.

The detail groups customizations by product/design and shows variants and quantities. It supports artwork attachment and replacement, locking, reconciliation, original purchase previews and an on-demand current-design preview. Historical amounts and financial records use retained facts. The latest pass removed GIDs, reference disclosures, Next step and routine expiry dates, and moved purchased items to the aside. Actual file expiry and imminent-deletion warnings remain.

Selection and bulk production printing remain deferred together. This was an agent decision under the owner's now-or-later choice, citing Shopify's advice to provide selection when an operation exists. Public selection components exist; the current app has no production-sheet operation. Assess this decision separately from whether the visual implementation is satisfactory.

## Sources and evidence to inspect when relevant

All paths below are relative to the repository.

| When | Read |
| --- | --- |
| Establish project requirements and current status | `AGENTS.md`, `README.md`, UI sections of `docs/delivery/state.md`, affected sections of `docs/architecture/implementation-plan.md` |
| Audit source priority and tooling preparation | `docs/delivery/notes/admin-ui-guidance-2026-10-20.md`, `.codex/config.toml`, `/Users/pc/.codex/skills/shopify/SKILL.md` and its App Home reference |
| Reconstruct earlier decisions and revisions | `docs/delivery/notes/orders-overview-implementation-2026-10-20.md`, `orders-reference-diagnosis-2026-10-20.md` and `orders-detail-refinement-2026-10-20.md` in the same directory |
| Inspect overview interactions | `apps/web/src/islands/OrdersOverview.tsx`, `apps/web/src/components/OrdersDisplayOptions.tsx`, `OrdersDateFilter.tsx` and `OrdersTableSkeleton.tsx` |
| Inspect detail composition and data | `apps/web/src/islands/PurchaseArtwork.tsx`, `PurchaseHistoricalPreview.tsx`, `apps/web/src/components/PurchaseItems.tsx`, `PurchaseCurrentDesign.tsx`, `packages/contracts/src/v1/purchase.ts` |
| Inspect the host, fixtures and checks | `apps/web/src/layouts/AdminLayout.astro`, `apps/web/test/admin/preview.mts`, its support directory, `purchase-browser.test.mts` and `preview.test.mts` |
| Assess the earlier public model/design research | `docs/delivery/notes/admin-design-feedback-2026-10-20.md`; check attribution and distinguish anecdotes from demonstrated causes here |
| Follow the requested prompt-writing method | `.agents/skills/writing-for-agents/SKILL.md`; provenance is in `.agents/skills/PROJECT-ADAPTATIONS.md` |

The guidance and implementation notes were written by the preceding agent and contain successive revisions. Some earlier statements are superseded later in the same file. Existing source-priority instructions are part of what the owner now wants assessed. Preserve product and security requirements while evaluating design guidance.

## Conditions encountered during the work

- Shopify's consolidated skill and Dev MCP were installed and exercised. The preparation note records skill metadata version 1.18.0 and MCP 1.17.0. Component validation targeted `polaris-app-home` 2.0-rc, with responses resolving the catalog to v2.0. Recheck exact installed versions before attributing behavior to them.
- Component validation returned successful results on multiple revisions that the owner subsequently identified as visually or behaviorally mismatched. During the latest cleanup, a validation response also reported VALID for a malformed TSX composition that the local parser rejected. Inspect that exchange before generalizing about validator coverage.
- The preceding agent reported that public App Home components do not expose the same search/filter builder and some table interactions used by Shopify's own admin. Verify the specific differences against current public documentation and the observed reference. This claim does not settle which source or implementation approach should be primary.
- Real Shopify overview and detail pages were inspected read-only in Chrome after the first rejection and during follow-ups. Some browser integrations were unavailable, so native computer-use access was used. The original in-app missing-icon report was not reproduced conclusively; later normal-browser checks rendered the exercised icons and fonts. A preview-only bounded proxy for official icon assets was added.
- The preview initially supplied a token/loading App Bridge double. Polaris treated it as embedded and hid its own header, while the surrounding title bar was absent. A test-only outer host was subsequently added. Distinguish preview-host behavior from real embedded-app behavior when assessing screenshots.
- Revisions included adding and later removing search-triggered filter popovers, a Date-only sorting control, custom column reordering, technical reference displays and Next step copy. The chat and Git history show the sequence; the cause and avoidability need assessment.
- Focused browser checks, builds, type checks and component validation were run. Passing results did not establish owner acceptance. The notes record an unexecuted PostgreSQL regression for the earlier date-query changes because local PostgreSQL/Docker prerequisites were unavailable. Some agent work was interrupted by usage limits. There is no consolidated measurement assigning elapsed time to individual causes.

## Local evidence and data limits

The last active preview URL was `http://127.0.0.1:62168/admin/orders`. Check whether it is still running before starting another process. The README documents the launch command and required runtime.

The opt-in `orders-rich` fixture supplies 55 synthetic orders across pages of 20, 20 and 15. Detail `/admin/orders/10000000-0000-4000-8000-000000000010` demonstrates multiple products, several sizes and repeated designs for one product. The fixture lives only in test support and is enabled with `INSIGNIA_PREVIEW_SCENARIO=orders-rich`. Its images are deliberately unavailable. Separate focused fixtures exercise actual artwork rendering and expiry. The preview performs synthetic reads and rejects commands; it does not establish native authentication or real write behavior.

The current purchase DTO lacks customer, shipping and fulfillment information and exact order-line-to-design lineage. The implementation uses thumbnail placeholders where matching would be ambiguous. Inspect the actual contracts before proposing additional order information. Preserve authorization, private artwork access, expiry, exact money, immutable purchase history and uncertain-write recovery when recommending presentation changes.

## Deliverable

Give the owner an independent assessment with:

- Findings supported by chat turns, code, documentation or reproducible observations. Separate established causes, hypotheses and unresolved questions. Account for requirements that changed during iteration.
- A source/tool table explaining the purpose, observed limits and proposed use of the live Shopify reference, public Polaris documentation, Shopify skill, MCP validation and supplementary skills. Evaluate continuing, changing or reducing their use from the evidence.
- A short working method that specifies what the agent inspects before implementation, how it checks composition and interactions itself, and which critical checks justify their cost. Include fonts, glyphs, density, targets, hover/focus, overlays, loading/recovery, responsive layout and multiple customizations where relevant. Keep the method usable during rapid iteration.
- A bounded next iteration with explicit differences from the native reference, unresolved dependencies and completion criteria. Keep implemented, tested, natively observed and owner-accepted states separate.

Use the minimum relevant checks. This audit requires no application test run merely to produce prose. Inspect real store data read-only, preserve unrelated work, and keep deployments and provider mutations within their existing authorization.
