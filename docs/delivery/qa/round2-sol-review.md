# Independent round-two evidence review

Date: 2026-11-08
Scope: read-only review of AGENTS.md, frontend/README.md, issues.json, root-round2.md, buyer-round2.md and state-integration-round2.md. Inspected the six requested actual screenshot files with view_image, plus root-round2-cart-qty2.jpg. No browser, provider, application or issue-register writes. admin-round2.md was not present at the final read. Applied the unslop writing skill.

## Verdict

Keep QA-011 through QA-014 separate. QA-013 is the clearest current native authoring blocker. QA-012 merits P1 investigation, but its named screenshot proof is materially weaker than the reports claim. The accepted demo remains the comparison reference for shared interactions. Shopify cart behavior needs native before/after evidence because the demo has no equivalent cart.

The native save screenshot preserves the selected editor structure seen in the demo: outline, Front view, canvas, inspector and draft actions. Different garment photos, native host chrome and variant-image grouping are fixture or integration differences. This evidence does not justify a new design audit or whole-page pixel comparison.

## Findings and priority

| Issue | Judgment | Evidence limit and next proof |
| --- | --- | --- |
| QA-011, P2 | Supported duplicate-photo defect. Shopify shows three media photos, while Add views says All (37) and visibly repeats the black hoodie across twelve cards marked Used in Front. | The screenshot proves the displayed total and repeated choices. It does not independently enumerate all 37 identities or all 13 reported in-use entries. The report/source explain 1 featured + 33 variant + 3 gallery references. Retain one issue for the repeated asset identity, including the cap corroboration, rather than counting each card or product as another defect. Verify unique selectable assets and retained variant assignment after correction. |
| QA-012, P1 | Retain as a reported native displayed-price/review regression requiring investigation. Two observer reports describe quantity 2 at $9.95 each / $19.90 after reload, with quantity 1 restoring $17.45. | The actual buyer-round2-cart-qty2-after-reload.jpg does not show that cart state. It shows a Designer header and artwork panel over Shopify recommendations. root-round2-cart-qty2.jpg has the same problem. buyer-round2-cart-qty1-restored.jpg does show quantity 1 and $17.45, but no visible customized-cart review control. These files do not independently prove the asserted before/after price or review-control transition. Label the narrative as native observer testimony and repair the evidence references before calling the pair screenshot-confirmed. Do not infer metadata removal, CartTransform cause, checkout acceptance or undercharge. Checkout was not used. |
| QA-013, P1 | Supported current first-save failure to confirm desired state. The screenshot shows one local Front view, an unconfirmed-write alert and Retry; the demo comparison shows a settled one-view draft. | A still image cannot prove dispatch, exact retry or persistence. Those claims depend on the recorded interaction and scoped readback. That readback found a version-1 scaffold with zero selectedSetup views. Say scaffold creation succeeded while the desired view save remained unconfirmed. This is distinct from the historical blocked Save click and must not be counted again under the old scrim issue. Prove first-save intent plus exact original-request recovery and fresh persisted readback. |
| QA-014, P2 | Supported recovery-feedback defect accompanying QA-013. The native screenshot shows the same recovery text in the top red banner and blue inspector notice, plus a loading indicator in the Shopify Save Bar. | The screenshot proves simultaneous feedback, not elapsed request settlement. Recorded retry completion and source supply that distinction. SelectedProductEditor clears writeBusy in finally but passes writeBusy OR adapter.pending() as saving; selected-product-client retains pending custody separately from busy. Keep the unresolved command and write gates, stop active loading after settlement, and show one recovery notice. This is a UI state defect, not a second persistence-cause finding. |

## Runtime and evidence boundaries

The old web image 76d5d0f9 started at 20:24:30Z. The current image 001ffe04 started at 22:05:03Z through another actor. Open frames can retain the old code. Fresh current Add views X, Escape and Cancel release the host according to the recorded fresh checks. Keep historical scrim screenshots as evidence of the old failure, without presenting them as a current native failure.

QA-013 was recorded from a fresh current editor. The buyer Designer was opened before the rollout; subsequent Shopify cart reloads occurred after it. That demonstrates an observed old-frame/current-backend interaction, not complete qualification of fresh current Designer assets. Compiled decoder markers and source changes are implementation evidence, not successful native file upload or persistence proof.

The duplicate gallery capture belongs to the earlier authoring sequence. Its count defect is supported for that observed state; a fresh current-build count replay would establish whether it still occurs after the rollout. Root clarified that 13 in-use entries was a DOM-derived total. The twelve visible cards are consistent with that count but do not independently establish it.

The mixed cart captures cannot prove the claimed cart prices. Later isolated replay and parent DOM evidence also establish that the mixed painting is a real integration defect, described below. Preserve the raw files and label their limits instead of treating filenames or the manifest as price proof.

## Follow-up: QA-015 background preparation paints over the cart

Root repeated the mixed-pixel state in an isolated empty-cart session with no other agents browsing. I independently inspected root-round2-background-frame-visible.jpg. It shows the rich T-shirt Designer header, canvas and artwork panel painted over Shopify navigation and recommendations. Root reports that the AX state remained an empty cart with no open modal, and that preparation expiry removed the frame and restored the normal empty-cart screenshot.

The parent evidence reported by root on a fresh reload is decisive for the visibility mismatch. The rich T-shirt srcdoc iframe had computed visibility visible and a 2560 by 1267 rectangle. Its parent was a DIALOG with open false, inert true, display block, visibility hidden and pointer-events none. These values match the initiallyHidden branch in apps/storefront/src/designer/modal.ts. I reviewed that source and apps/storefront/src/designer/frame-host.ts independently. finishInitialization waits for initialized readiness and stylesheet confirmation, then unconditionally sets the fixed, full-viewport iframe visibility to visible. It does not check initiallyHidden or whether the parent dialog is open. Explicit child visibility can override an ancestor's hidden visibility; inert and pointer-events do not prevent painting.

QA-015 is therefore supported as hidden preparation painting over the storefront, with a source mechanism consistent with the same-frame native parent evidence. Recommend P1 because it obscures the native cart without an opened, interactive modal or matching accessible modal state. Record it separately from QA-012's displayed-price behavior. The existing mixed captures can support QA-015, but still cannot prove QA-012's prices or review-control absence.

The focused regression should initialize a prepared hidden Designer, assert that it paints no UI before the explicit open action, then open it and assert visible content, modal/focus behavior and normal close. Include preparation expiry and readiness completion after cancellation. Native replay should compare empty-cart pixels before preparation, while ready-but-hidden, after explicit open/close and after expiry. Keep the pricing investigation separate.

## Smallest useful follow-up

1. Repair QA-012 evidence with a clean current-Designer entry, owned-line add, native quantity change, fresh cart reload, visible price/review state, restoration and cleanup. Record runtime identity. A controlled integration regression should also inspect the exact owned operation and its validation/repair result. No checkout is needed to prove the reported UI regression.
2. Replay QA-013 and QA-014 together with controlled unknown-save and failed exact-retry results. Assert stopped loading, one recovery notice, retained intent and blocked replacement writes, then confirm successful recovery with fresh readback.
3. Complete current native PNG/JPEG Add views upload and persisted assignment readback. The decoder marker cannot close QA-010.
4. Keep unexercised buyer upload/movement, narrow layout and dirty-switch paths visible as omissions. The state review also identifies missing production-bridge assertions for terminal artwork expiry with production-choice preservation, reload during ambiguous acceptance, and buyer 401/403 delivery. These are coverage gaps, not newly reproduced defects.

The 73 state cases marked not-run are a checklist, not an execution ledger. The reported focused admin and direct runtime passes do not close the missing native or production-bridge paths. The customer browser attempt that failed fixture loading is neither a product failure nor a passing test run.

## Final evidence follow-up: clean current cart replay

I independently inspected root-round2-clean-cart-qty1.jpg and root-round2-clean-cart-qty2.jpg. Both are clean native cart pixels. The first shows the rich T-shirt, Zwart / XS, quantity 1 and $17.45 unit/total. The second shows the same product title and variant, quantity 2, $9.95 unit and $19.90 total. This pair now visually supports QA-012's displayed-price transition. It supersedes the earlier price-proof gap, while preserving the earlier mixed files as QA-015 evidence.

Root reports that this replay began with fresh current Designer assets after the rollout, Linkerborst at $7.50, deferred artwork and one Add from a $17.45 review. One native Increase settled to the lower price, a full reload preserved it, and natural preparation expiry allowed a clean quantity-2 capture. That sequence resolves the old-frame qualification limit for the newly reproduced behavior. The screenshots cannot themselves prove reload or the original quote breakdown; those remain recorded native interaction evidence.

The review-control count change, zero at quantity 2 and one after restoring quantity 1, is DOM evidence supplied by root. Neither clean screenshot visibly displays the quantity-1 review entry. Checkout is visibly present in both images; its enabled state is reported DOM evidence. No checkout, accepted-charge or server-cause conclusion follows.

Root restored quantity 1, removed only the owned line and freshly read an empty-cart main with zero cart tables. The cleanup screenshot was overpainted again and is not clean empty-cart pixel proof. Treat cleanup as native DOM/interaction readback, keeping that image as an overlay observation.

I also read round2-report.md. Its findings keep persistence, loading feedback, hidden preparation and pricing separate and avoid unsupported checkout/cause conclusions. One editorial gap remained at review time: QA-012 says the fresh reproduction is recorded below, but the file did not yet contain that sequence or links to the two clean cart captures. Add those references or remove the pointer. The earlier recommendation to repair QA-012's screenshot proof has now been completed for displayed prices; the review-control transition retains its separate DOM evidence label.
