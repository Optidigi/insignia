# Orders state completeness audit — 28 October 2026

## Scope and method

Reviewed the Orders list, purchase detail, original artwork, attachment upload/replace, artwork ZIP, and production-sheet paths. Read the current `AGENTS.md`, README, implementation plan, order workflow notes, diagnosing-bugs/TDD instructions, and the matching Checklist Design checklists for [single-item detail](https://www.checklist.design/web-app/single-item-detail), [data tables](https://www.checklist.design/web-app/data-table), [uploading media](https://www.checklist.design/flows/uploading-media), and [filtering items](https://www.checklist.design/flows/filtering-items). Compared the implementation plan’s Orders/artwork contract (`docs/architecture/implementation-plan.md`, §7.2) with the current reducers and their callers. Shopify’s pinned App Home [index-table pattern](https://shopify.dev/docs/api/app-home/v2.0/patterns/compositions/index-table) supports search, filtering, sorting, bulk selection, and pagination in this surface.

Used the built local web artifact with an ephemeral fixture server and one Playwright browser for the additional status probes. The server responses and purchase data were synthetic and read-only; no Shopify/provider writes, app-source changes, build, reset, or checkout were made for this audit. The exact scratch probe is preserved at `/tmp/insignia-state-audit-orders-probe.mts`; the temporary repo copy was removed after the independent owner repro. Screenshots: `/tmp/insignia-orders-original-410.png`, `/tmp/insignia-orders-zip-503.png`, `/tmp/insignia-orders-zip-410.png`.

## Findings

Correction follow-up: both findings below are corrected and independently reviewed through actual browser callers. Original downloads have an identity-scoped terminal unavailable state. ZIP entries distinguish authenticated metadata unavailability from retryable reads and short-lived storage URL failures; empty transient results expose the existing retry action, while partial results retain one download primary. Four new browser checks and the archive module check pass independently. The [consolidated correction and integrated verification record](state-completeness-audit-2026-10-28.md) owns the final result; the findings below preserve the pre-fix observations.

### High confidence: terminal original-download 410 is presented as retryable

The detail shows an **Original artwork** disclosure for a purchased revision when it differs from the current asset (`apps/web/src/islands/PurchaseArtwork.tsx:341-349`). Its download component catches every failure and writes “The original file could not be downloaded. Try again.” (`apps/web/src/components/OriginalArtworkDownload.tsx:25-57`). Only 401/403 are handled by the parent as access revocation (`apps/web/src/islands/PurchaseArtwork.tsx:426-439`). The purchase router maps `ARTWORK_UNAVAILABLE` to HTTP 410 (`apps/web/src/server/purchase/http.ts:171-185`); the download service also returns that code for missing, unusable, or expired assets (`packages/application/src/purchase/artwork.ts:70-82`).

An actual browser fixture with an original revision ID different from its current replacement returned `410 {"code":"ARTWORK_UNAVAILABLE","message":"Purchase request requires review"}`. The download button remained visible and the retry message appeared; no unavailable/expired state was shown. Screenshot: `/tmp/insignia-orders-original-410.png`. This makes a terminal retention/access failure look recoverable and invites repeated clicks. **Minimal recommendation:** classify 410 as unavailable in this resource’s local state, show terminal copy, and stop offering the failed download action; reset that state when the purchase or original revision identity changes. Keep 503 retryable. No purchase DTO or backend change is needed.

### High confidence: ZIP entry failures conflate transient 503 with terminal 410; all-failed recovery is hidden

`prepareArtworkArchive` catches all per-entry errors except 401/403 and maps untyped failures to “The original file could not be loaded. Retry or download it individually.” (`apps/web/src/shared/artwork-archive.ts:136-173`). HTTP 410 and 503 therefore receive the same entry reason. `ArtworkArchiveDownload` only offers its in-dialog “Try again” button for a flow-level `message`; a prepared result with zero files has no primary download action (`apps/web/src/components/ArtworkArchiveDownload.tsx:335-352`).

The browser probe returned metadata responses 503, 503, then 410. Each modal preparation produced “0 files ready” and the same per-entry retry/individual-download guidance; no in-modal retry, ZIP download, or order link was available. Closing and reopening triggered another metadata read, so the 503 case is **recoverable but awkward**, not a hard dead end. The 410 case is terminal, but still says retry; with zero files, the user cannot download from the modal. This is a weaker issue than the detail 410 because the modal can be reopened, but it misstates the terminal case and hides the transient recovery action. **Minimal recommendation:** retain HTTP status in the per-entry result; distinguish terminal 410 from retryable read failures. When every entry failed transiently and no file is ready, expose the existing “Try again” primary action in the modal. Do not add a second primary action for a mixed partial-file result; preserve its verified partial ZIP and manifest behavior. No DTO/backend change is needed.

### No additional high-confidence gap found in the reviewed paths

The remaining order journeys have clear states and recovery in current source and focused tests:

- Orders query/search/filter changes clear selection; stale read responses are ignored. Server-query changes clear old rows and preserve the filter toolbar. Failed list and cursor reads retry the requested scope. Cursor breadcrumbs preserve page-local search/artwork filters and date/sort state.
- Purchase reads distinguish transient refresh failure (keep last observation and offer retry), 401/403 (clear private data), and 404 (show an order-missing path). Out-of-order reads cannot restore data after denial/missing.
- Upload/replace sessions fence stale completion, clear staged files on cancel/context change, require one selected upload before attach, and preserve existing source artwork until a confirmed replacement. Locked/erased/expired states follow the retained payload and authorization rules.
- Production-sheet batch preparation reports each omitted order and reason, links each order back to detail, supports “Prepare all selected orders again,” and only offers a PDF action when at least one sheet is ready. Partial PDF text names included and selected counts. Existing tests cover changed-order invalidation and permission loss.

The implementation-plan contract and second-pass workflow notes describe these same boundaries: historical purchase terms remain distinct from editable design, exports read fresh authorized state, retention does not extend on download, and production status is not invented. Asset retention is seven days (`packages/application/src/artwork/artwork.ts:4-11`); retained purchase design payload has a separate maximum of six calendar months (`docs/architecture/implementation-plan.md:552-562`). Current DTO expiry belongs to the active asset (`packages/contracts/src/v1/purchase.ts:20-46`), which is why a previous original revision’s actual 410 is currently discoverable only when its download request fails.

## Checklist pass

Statuses below reflect functional applicability to this Orders surface, not a visual score.

### Single Item Detail — Web app

| Status | Checklist item | Evidence / judgment |
|---|---|---|
| Present | Clear title or identifier | Order number is the detail heading and breadcrumb return target. |
| Present | Status indicator (if applicable) | Shopify/payment, artwork, and exception statuses carry text as well as tone. |
| Present | Key details section | Purchased designs/quantities and order economics are grouped; secondary order context stays in the aside. |
| Present | Edit action | Eligible placements offer Attach/Replace; locked, expired-payload, and unauthorized cases restrict it. |
| Present | Related items or activity | Artwork history and retained events are shown when available. |
| Present | Breadcrumb or back navigation | Orders return link preserves a validated list query/cursor. |
| Not needed here | Destructive actions | A purchase record is historical; deleting or archiving it from this app would conflict with Shopify ownership. |

### Data Table — Web app

| Status | Checklist item | Evidence / judgment |
|---|---|---|
| Present | Sortable columns | Date sorting is available and has a visible current direction. Other fields are not sort dimensions in the current Orders contract. |
| Partially present | Column visibility and order | Display options hide/show supported columns; drag reordering and persistence are not part of the current screen contract. No task-critical need was found. |
| Present | Row selection and bulk actions | Selection is page-scoped, counted, cleared on scope changes, and exposes supported ZIP/PDF actions. |
| Present | Row actions on hover | Row navigation remains discoverable without adding a dense per-row action cluster. |
| Present | Search and filter | Page-local search/artwork filters and server date filters are distinct and visible. |
| Partially present | Pagination | Cursor navigation and page-return trails work; arbitrary page-size selection is not offered. |
| Present | Frozen columns | The order identity remains available through the horizontally scrollable table on narrow layouts. |
| Present | Export action | Selected current original files and production sheets have explicit capped preparation and partial-result reporting. See findings above for all-file failure recovery. |
| Present | Empty and loading states | Skeleton, no-orders, no-page-local-results, query-failure, and retry states are present. |

### Uploading media — Flows

| Status | Checklist item | Evidence / judgment |
|---|---|---|
| Present | Empty state | Upload area gives a direct selection/drop route. |
| Present | Drag and drop interaction | Drop target feedback is implemented in the shared upload flow. |
| Present | Progress indicator | Upload and processing phases communicate current work. |
| Present | File restrictions & constraints | Accepted image formats and size cap are shown and validated. |
| Present | Outcome status | Success, rejection, and attach failures remain visible with a corrective path. |
| Present | Upload actions | Cancel clears staged data; retry/reselection and attachment actions are separated. |
| Not needed here | Showing multiple uploaded files | Each placement has one current asset; multi-file library management is outside this order attachment contract. |

### Filtering items — Flows

| Status | Checklist item | Evidence / judgment |
|---|---|---|
| Present | Show action near item collection | Search and filter controls sit above Orders. |
| Present | Show available filter options | Filter popover exposes the supported artwork/date options. |
| Present | Consider different filter types | Artwork state is page-local; date range/sort are server collection queries. |
| Present | Show active filters clearly when applied | Active filter and date summary states remain visible. |
| Present | Provide easy filter removal | Individual filters, clear/reset, and search clearing remain available. |
| Partially present | Show result count | Current-page row count/selection are visible; no full collection total is supplied by the cursor API. A total was not needed to recover a specific failure. |
| Present | Empty state | Empty collection and no-match results explain the scope and how to recover. |

## Focused verification

Commands ran with Node 24 from the configured PATH. These are focused checks, not a rerun of the 686-test baseline.

```text
PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH node --test apps/web/test/admin/orders-audit-scratch-20261028.mts
PASS 1/1. Browser fixture observed original download 410, 503, 401, 401, 403; 401 is retried once with a fresh token, then 401/403 clear private detail; 503 stays retryable. ZIP metadata observed 503, 503, 410 and the modal recovery/copy differences described above.

PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH node --test apps/web/test/admin/index-workflow-state.test.mts apps/web/test/admin/purchase-attachment-state.test.mts apps/web/test/admin/prepared-export-state.test.mts apps/web/test/admin/remote-read-state.test.mts apps/web/test/admin/artwork-archive.test.mts
PASS 10/10. Covers stale page/read/selection, export lifecycle invalidation, attachment session ordering, denied/missing reads, archive integrity/omission/change/expiry/permission denial.

PATH=/Users/pc/.nvm/versions/node/v24.21.0/bin:$PATH node --test --test-name-pattern='merchant attaches verified upload and permission loss removes private work|missing historical originals remain explicit and permission loss clears all private purchase work' apps/web/test/admin/purchase-browser.test.mts
PASS 2/2. Existing browser cases preserve verified upload and clear private work after 403.
```

No full suite or application build was run. Root independently reproduced the status observations in `/tmp/insignia-state-audit-orders-root-probe.log`.
