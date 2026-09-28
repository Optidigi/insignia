# M0-011R local provider-matching correction

Date: 28 September 2026. Scope: existing `Optidigi/insignia` PR #14 only, reviewed base/effective merge base `88dca8ebb4aad6baa24922508335e14038abbc98`, prior head `15c4281a5d08fa509a03ac9bba47d9b5dd59889c`. The attributed [principal review](../../../../docs/delivery/PR-014-principal-review.md) requested two local changes. Native GitHub REQUEST_CHANGES failed HTTP 403 and was not posted. No merge or live provider action is authorized by this correction.

## Full-client failed baseline

The attached principal's Node 22 review had run the complete M0-010 parser plus a disclosed guard excerpt, **not** the full M0-011 client. Its original [reproduction package](principal-reproduction/) and [source verification](principal-reproduction/source-verification.json) are retained as supplied. The handoff manifest verified all 13 supplied record hashes. The saved parser source blobs match this repository's M0-010 `partner.ts` (`654f3ce9b673bd05ff2a56408aa2c5ed7e2cd6f2`) and `time.ts` (`2b04172376778de7193738eb986f2843988146ef`).

Before editing, `node spikes/m0-011/evidence/m0-011r/principal-reproduction/reproduce.mjs /home/serveradmin/insignia-m0-011-worktree` on **Node v24.21.0** exited 0 by its *old-defect confirmation* contract. [Captured output](pre-fix-node24.json) shows the complete synthetic `PartnerClient → AppEventsClient.send` path: the canonical control reached one captured POST; seconds-only `Z`, equivalent offset and reversed valid items each returned `GUARD_REJECTED` with zero POSTs. Four economically or temporally different controls rejected. `networkCalls: 0` in that script describes its injected synthetic clients, not a live provider audit.

The new public-seam regression was added before the guard change. `node --test test/provider-matching.test.ts` from `spikes/m0-011` exited **1**: the canonical control passed, but `seconds on first read` returned `GUARD_REJECTED` instead of a synthetic `RECEIVED`. [Red output](red-public-seam.txt) preserves the failure. The test uses two actual Partner reads and a captured synthetic App Events POST; it does not call Shopify.

## Correction and green evidence

The guard now uses M0-010's validated `canonicalInstant` for both provider cycle endpoints and compares those canonical values with the already validated exact manifest instants. It selects exactly one flat item by expected plan handle and `FlatRatePrice`, and one meter item by expected meter handle and `TieredPrice`, from the exact two-item array. Existing active, currency, zero recurring/flat-tier/per-unit amounts, observed zero cost, tier order, identity, journal, token, endpoint, redirect and final Partner read checks remain in place. Raw Partner bodies are retained for the guard's other checks; the test does not rewrite provider responses.

`node --test test/provider-matching.test.ts` now passes **2/2**. The positive matrix covers canonical control, seconds-only and offset representations on either Partner read, both item orders on either read, and combined changes. Each reaches exactly one captured POST with the original body/key/time and one journal reservation. Eighteen negative cases reject changed start/end by one millisecond, invalid/missing cycle, wrong app/shop, nonzero recurring, flat-tier or per-unit charges, wrong/duplicate/extra items, reversed graduated tiers, pending update and active trial. Final-read rejections preserve one reserved attempt and zero POSTs; first-read rejections preserve zero attempts and zero POSTs.

The original principal script was rerun against the corrected full client. It exits **1** solely because it asserts that the old defects must still be present; [captured corrected scenarios](post-fix-node24.json) show all eight expected outcomes now agree, with no falsely rejected equivalent representation and zero network calls. This is an expected inverse of the diagnostic's old-defect assertion, not a failing corrected regression.

| Command | Result |
|---|---|
| `cd spikes/m0-011 && corepack pnpm install --frozen-lockfile && corepack pnpm check` | PASS, Node `v24.21.0`, pnpm `12.6.0`, strict TS and **22/22** synthetic tests. |
| `cd spikes/m0-010 && corepack pnpm install --frozen-lockfile && corepack pnpm check` | PASS, strict TS and **34/34** earlier billing tests, including R1/R2 from M0-010R. |
| `python3 -B spikes/m0-007/scripts/check-history.py` | PASS, v1.2 plan SHA-256 `8bb45ac9e2834bf047824a2e3dda4da7f76692bae685f6657da7b3ab03d0b145`, ledger `97ebb79ddc53000c53c46218ba8c83a5ba2279720ed07ff50809706b4f1a800a`, 41 prior sources and 120 receipts unchanged. |
| `git diff --check` | PASS. |

Fresh independent read-only Spec and Standards/security reviewers found no correction defect in the integrated working diff. They each ran the full M0-010 and M0-011 local suites on Node 24 and made no provider call. Final-head GitHub CI is recorded in the existing PR's body after the final push; these local reviews do not replace principal review.

No merchant-authenticated API, token acquisition, live event, plan, meter, subscription, preview, grant, order, payment or staging change occurred. The previously disclosed public-App-Pricing, actual Partner App GID, isolated no-charge contract, approved credentials and operator-wide event-attempt accounting prerequisites remain open. This correction does not pass G8.
