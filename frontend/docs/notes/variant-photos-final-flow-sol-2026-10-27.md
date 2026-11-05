# Variant photo final flow review

27 October 2026. Independent review of the local frontend implementation. I read the UI delivery workflow, original colour-variant direction, product polish review, assignment model, panel, editor, selection helper and browser regression. I did not operate the shared review browser or change application code.

The current flow keeps variant IDs separate from image grouping, handles sparse actual combinations, preserves explicit shared-image intent, clones view assignments and remaps cloned placement IDs. Products without variant metadata keep the shared-image path. Shared artwork edits preserve existing alignment exceptions. Changing appearance preserves view selection and requires an explicit scope change for alignment edits.

## Findings corrected during review

1. Retrying a failed photo previously removed its publication block before recovery. The final patch keeps failed URLs, tracks pending retries, blocks publication for either state, and clears the state after a load result. The active canvas supplies its own success result so a thumbnail cannot clear its failure. Pending rows remount their thumbnail because the visible failure condition excludes pending retries. The browser script now holds the retry response and verifies the publication dialog says to wait before releasing it.
2. Undoing regrouping previously lost the selected appearance. The final history selection map includes the appearance key, and history restoration validates it against the restored groups. The browser script now checks White / Relaxed after Undo and Relaxed after Redo, rather than only checking that the previous selector returns.

Choosing Same image for all variants intentionally disables group assignment resolution and keeps cached assignments for later restoration. I do not classify that explicit opt-in as data loss. Contextual copy explaining that it also uses shared artwork areas would help a merchant who has alignment exceptions, but it is a small copy improvement rather than a correctness blocker.

## Evidence and limits

I independently ran `node --test apps/web/test/admin/placement-variant-photos.test.mts apps/web/test/admin/placement-variant-editor-selection.test.mts`. All 26 checks passed. These cover model behavior and selection resolution, including old products, cloning, sparse combinations, grouping impact, missing photos, alignment bounds and unchanged shared geometry.

The browser script provides assertions for changed garment pixels, panel focus, bulk targets, missing-image navigation, keyboard selection, saved draft reload, selected view/appearance reload, regrouping and successful image retry at desktop, phone and narrow sizes. I inspected that script but did not rerun it during this review. I also inspected the final pending-retry and actual Undo/Redo value assertions. The implementing agent is rerunning the browser capture suite. Repeated retry failure is source-reviewed, rather than a separately asserted browser case in this script.

Catalog additions are model behavior only. Live Shopify catalog refresh, stable catalog identity reconciliation, production capabilities by variant and published revision preservation remain later integration work. This review does not establish live Shopify behavior, final pixel acceptance or owner acceptance.

Final source verdict: the implementing agent corrected both concrete findings. I found no remaining blocking correctness or workflow issue in the reviewed frontend scope. The browser capture run must still pass before its new assertions count as observed evidence. Pixel acceptance belongs to the separate visual review.
