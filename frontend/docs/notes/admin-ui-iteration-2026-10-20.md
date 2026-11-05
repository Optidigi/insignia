# Admin UI workflow iteration

Local work on `codex/ui-redesign`, based on HEAD `56ab3420b05013b693faaf6c45fa1b82e48a8cd0`. Earlier dirty UI/demo work was preserved. This pass implements the owner's broad admin assignment. It is not deployed or owner-accepted.

## Completed workflow changes

| Review area | Result |
| --- | --- |
| Placement workspace | Controls sit beside a sticky drawing on desktop; the drawing comes first on mobile. Actual garment images were inspected at both widths. |
| Image and geometry recovery | Explicit resets restore the shared image or area independently, preserving unrelated view and pricing choices. |
| Configuration removal | Native confirmations explain method, area, view and size removal. Shared definitions survive while another view uses them; dependent prices are removed with their last use. |
| Large configurations | View, variant and area search preserves the selected context. Large pricing tables paginate at 25 rows. |
| Price validation | Raw invalid text survives page/filter changes. Go to invalid price clears filters, reveals its page and focuses its native input. |
| Native optional choices | Explicit UI-only values prevent empty Polaris options from becoming label-derived variant, placement, size or filter IDs. Switching back to shared settings saves shared geometry. |
| Price review | The configured choices produce an exact decoration total. Free, unavailable and invalid prices remain distinct. Garment prices stay separate. |
| Products | A dedicated index supports whole-row navigation, Enter search, applied query/cursor restoration, previous-page navigation and authorization recovery. Dead picker code was removed from the configuration editor. |
| Long imported names | Orders and Products keep a three-line row label with the full accessible name and a native tooltip for long text. Merchant labels wrap inside configuration and order content. |
| Orders on narrow screens | The search field uses a full second row when needed; filter/status/display controls retain usable space at 320px. |
| Date-filter recovery | Failed date queries offer Clear filters even when the table could not load. |
| Design preview | Routine historical-refresh controls and success chatter are removed. Actual load/expiry failures have a scoped recovery action; current and purchased designs remain separate. |
| Artwork updates | An attachment result fences an older parent read so the newer artwork cannot disappear after an in-flight refresh settles. |
| Artwork history | Recent events load first, with more available on demand. Product, repeated-design number and placement identify the affected original. |
| Settings | The hub links to supported configuration/account tasks. Permissions has its own page and preserves explicit optional-scope consent. Translation/preferences have no fake settings. |
| Privacy | Request selection clears stale details. Per-order downloads keep their context and feedback. Duplicate operations are fenced. |
| Methods and account tasks | Enter submits method creation, Rename states the actual operation, dates are readable and setup guidance describes supported theme actions. |
| Production worksheet | A4 pages prioritize exact garment quantities, real garment views, numbered artwork references and placement/method/size instructions. Three-view designs use one row. Long labels paginate with repeated context; warnings stay on every page. |
| First paint and navigation | Content waits for runtime/data readiness. Static recovery screens are gated too. A stalled Polaris download reaches recovery; outgoing navigation retains its layout until replacement. The editor skeleton reserves full-width product rules without a false preview column. |
| Realistic local editing | Three public legacy garment configurations are adapted into in-memory front-view drafts. Save/reset and preview navigation reuse the real app's unsaved/uncertain-write guard. The footer reflects the route actually reached. |

## Sources and engineering boundaries

Shopify's pinned [Polaris App Home 2.0-rc](https://shopify.dev/docs/api/app-home/v2.0-rc) contract governs components. [Content guidance](https://shopify.dev/docs/apps/design/content) and [layout guidance](https://shopify.dev/docs/apps/design/layout) govern the hierarchy and copy. Current Vercel web-interface rules supplement focus, text containment and form checks. Project Matt Pocock TDD/diagnosis/review skills guide behavior changes and independent review.

Production pages retain App Bridge, authenticated reads, CAS/idempotency, exact money, retained order facts and real expiry. No new provider operations or invented production statuses were added. The PDF is a raster worksheet with artwork previews, not original production files or a physical calibration. Dimensions appear only when retained configuration supplies them.

The preview server, synthetic host, asset service worker, command adapters and public asset snapshot are development-only under `apps/web/test/admin`. They bind to loopback, reject production credentials, save in memory and do not forward commands to Shopify or production services. The catalog adapter intentionally exposes only the featured/variant image capability present in the actual DTO.

## Verification

Focused browser coverage exercises desktop/mobile layout, direct Konva editing, shared/variant recovery, confirmed removal, price paging/error focus, product search/navigation, privacy request context, method Enter submission, order filter recovery, artwork attachment races/history, preview replacement/download/lock/reset and runtime loading recovery. Tests use local doubles and built app routes.

Production export checks render real legacy garment/artwork examples, large quantities and long Unicode labels. Exported PDF pages were rendered through Poppler and visually inspected. The final web build checks 123 files with no errors, warnings or hints. Strict admin-test TypeScript, scoped Biome, Polaris 2.0-rc component validation and source/Polaris boundary checks pass. Nine placement scenarios, the changed account/product workflows and the selected existing editor/order regressions pass. The real mixed-order PDF has three A4 pages.

No fresh native Shopify appearance observation, owner acceptance or release qualification is implied. Local success does not resolve the separate native/retention/operator obligations in current state.
