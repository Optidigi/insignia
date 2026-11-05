# Frontend workflow follow-up

Status: implemented and locally verified. The maintained frontend command passes, with explicit environment-gated skips and the separate presentation gate recorded below. This follows the owner's approval to research and implement the remaining frontend workflow improvements, with independent Luna Max research, implementation and review. The established presentation and production/preview separation remain the contracts. No deployment or provider mutation is part of this work.

## Sources and scope

Root reread Matt Pocock's [architecture article](https://www.aihero.dev/how-to-make-codebases-ai-agents-love), his [pinned architecture skill](https://github.com/mattpocock/skills/blob/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/improve-codebase-architecture/SKILL.md), and the [Preact v10 hooks guide](https://preactjs.com/guide/v10/hooks/), matching the installed Preact 10.29.8. The prior [direct video inspection](pocock-video-implementation-recheck-2026-10-28.md) remains the evidence for typed events, reducers and small UI event handlers. No OpenAI or Anthropic architecture material supplies the recommendation.

The practical decision is to concentrate real workflow decisions behind public commands, keep resource and authentication ownership explicit, and test those commands plus their actual browser wiring. It is not a requirement to split every long file, add a global store, adopt a particular effect helper or turn ordinary independent controls into machines.

## Implemented changes

- The persisted editor now uses one controller for draft/save/publication and authenticated recovery. Its public commands reject loading, suspended, denied and disposed callers. A definite stale-publication rejection can retire an old intent only after a matching authenticated read proves a newer un-published draft. Ambiguous 408/429 save responses keep the exact command. See the [editor receipt](editor-workflow-deepening-2026-10-28.md).
- `method-library-workflow.ts` owns list/read failures, create/rename/removal requests, synchronous claims, exact manual retries, denial, suspension and disposal. `MethodLibrary.tsx` renders the snapshot and invokes semantic actions. Query text, overlay effects and keyboard listeners retain their UI responsibilities.
- Methods writes require a successful current read. A failed post-suspension read now offers read recovery and cannot enable a retained write. Every retry after suspension requests a fresh session until a read succeeds. Late original responses cannot release the current retry claim.
- Methods read and mutation results enter as `unknown`. Invalid records, duplicate IDs, missing mutation records and mismatched rename identities cannot announce success. Unconfirmed mutation results retain the exact command for manual retry.
- The production buyer claims price review before allocating or cancelling a request lane. Duplicate review events are rejected in both controller and reducer, the duplicate action is disabled, and pending review is announced. An edit can still invalidate its read result. Renewal cannot replace an active review; explicit cart removal retains its separate cancellation path.
- Expired proposals no longer leave an unusable Add to cart action visible. Draft selections survive and the existing review action requests current prices. Successful removal clears the obsolete renewable quote identity.
- A failure preparing optional advisory confirmation cannot strand an already verified cart application in a busy UI. Fingerprint preparation and confirmation share the existing best-effort catch; actual cart integrity and mutation-failure checks retain their earlier authority.
- The polished buyer's unload protection uses its existing unsaved-draft predicate. Saving clears the warning; deleting all placements from a saved design remains protected; Undo to the saved design clears it. Preview exclusions remain explicit. No new browser persistence or simulated checkout capability is introduced.
- The fast maintained model command includes the new Methods workflow tests. Broad verification cleanup has separate ownership and a receipt.
- The existing photo picker no longer dispatches a selection change when an upload adds no valid images. This preserves the readiness of the already selected image after a rejected upload. Processing/decode checks now wait for the actual enabled action rather than assuming selection alone means readiness.
- The production renderer follows editor availability and design-stage visibility. A configuration read arriving before the editor's render state, or a later stage remount, can no longer leave an empty canvas. The overlapping-area drag regression now waits for and manipulates a real Konva canvas.
- The current drawing task remains readable at 320 and 390 pixels. A narrowly scoped flex rule reserves the task caption's width. This follows Shopify's [guidance against truncating instructions](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/truncate). The modified Methods and placement sources pass component validation against the configured Polaris 2.0 release candidate; this does not validate every native element in the repository.
- The local preview installs its bounded icon transport before Polaris regardless of the original async/defer attribute. CDN-blocked icon and local-host security regressions pass. No production remote-fetch capability was added.

## Verification

New public Methods command tests were developed through failing and passing checks for duplicate claims, malformed success, invalid lists and failed authenticated resume. They also exercise versioned rename/removal, denial and disposal. The existing transaction checks remain.

Buyer controller checks pass, including duplicate request allocation, stale completion, expiry recovery and cleared renewal identity. The production buyer browser check passes with a held review response, two synchronous clicks, visible pending state, clock-driven expiry and a fresh review. A separate browser regression passes for the obsolete renewal action after removal.

The polished buyer browser suite passes eight tests across all 13 scenarios. The new unload case initially failed for the saved-design warning, then verified both the saved and dirty-empty cases after the fix. It dispatches cancelable unload events to check actual listener wiring; it does not claim proof that every browser will show a native unload prompt.

Root's focused Methods browser suite passes four tests, including Enter submission, failed-read recovery and exact replay. The placement suite passes six targeted cases, including upload cancellation, rejected batches preserving the existing valid selection, first setup, measurement and readable current tasks at 1440/390/320. The production overlapping-area drag case passes against a real Konva canvas. The advisory-confirmation failure was reproduced through an injected platform digest rejection after cart application, then passed with completed UI status; independent Sol review reran it.

The frontend dependency graph has no violations across 346 modules and 927 dependencies. The unchanged Polaris inspector's own eight positive/negative regression controls pass, preserving the distinction between those checker controls and the separately red application presentation audit.

The integrated browser run exposed a stale-input focus check during placement duplication. A deterministic reproduction began focus polling with the placement menu open, then duplicated through the actual menu action. The old input disconnected and the new input owned focus, while the old check returned false. The helper now resolves the current unique connected input on every poll within its unchanged one-second budget. The regression also types into the duplicate through the keyboard. The recorded red and green runs are `/tmp/frontend-placement-focus-poll-red-confirmed.log` and `/tmp/frontend-placement-focus-poll-green.log`. No runtime focus workaround was added. Independent Sol source review found no material issue in that correction.

An independent Luna Max reviewer reran the Methods command/transaction and production buyer controller/browser checks and examined actual caller wiring. The final maintained command passed after the corrections described here. Earlier broad failures remain historical evidence in the baseline receipt, rather than the status of this candidate.

An independent Sol review ran 36 public command/transaction checks and inspected the actual 320/390 task captions and compact mobile Methods screen. It found no material standards/spec finding within that reviewed scope. See the [review and limits](frontend-workflow-final-sol-review-2026-10-28.md).

## Final integrated result

Ran under Node 24.21.0 with the explicit polished buyer source root:

```sh
INSIGNIA_DESIGNER_PROTOTYPE_ROOT=/Users/pc/Development/Insignia/designer-prototype corepack pnpm test:frontend
```

The maintained command exited successfully. It includes the polished buyer strict build and configuration checks, merchant build, production buyer and theme-asset build in an isolated candidate, all 36 effective strict TypeScript projects, source coverage and the existing formatting/lint gate. Existing non-blocking lint warnings remain.

| Test stage | Passed | Failed | Cancelled | Explicitly skipped |
| --- | ---: | ---: | ---: | ---: |
| Merchant, shared artwork and polished buyer | 627 | 0 | 0 | 60 |
| Production buyer and cart contracts | 59 | 0 | 0 | 2 |
| Total | 686 | 0 | 0 | 62 |

The skips retain their existing prerequisites: PostgreSQL integration, approved native customer-preview origin, opt-in gallery captures and the production Functions runner. They are not failures filtered out of this run. See the [baseline repair receipt](frontend-verification-baseline-repair-2026-10-28.md) for the exact groups and prior failures. The fast `test:frontend:models` command separately passed all 90 checks without skips; these overlap the maintained suite and are not added to its total.

The full spec log is `/tmp/frontend-state-maintained-verified.log`; TAP receipts are `/tmp/frontend-state-maintained-web-verified.tap` and `/tmp/frontend-state-maintained-storefront-verified.tap`. `git diff --check` passes. The loopback preview remains available on port 62168; Home, Products, Settings and the gallery return HTTP 200. HTTP availability alone does not establish UI acceptance.

The research, implementation and verification included independent Luna Max agents. The independent Sol review found no remaining material standards/spec finding within its recorded scope. The current architecture is suitable for the next UI/UX pass. Another state library, global controller or general file-splitting pass is not justified by the observed problems. No deployment, live Shopify qualification or release approval is claimed.

## Retained presentation gate

The separate static Polaris presentation inspector still reports 41 messages across 26 unique file/tag pairs. These cover existing Home charts, Getting Started controls, table keyboard scrolling, Billing/worksheet description lists and other native markup. This is a real red repository gate. The inspector is unchanged. Replacing those elements mechanically could alter the accepted UI or its keyboard/semantic behavior; the independent reviewer recommends a deliberate pass with the owner's planned UI work. A passing frontend command, source coverage or component-type validator does not establish that all repository boundary checks pass.
