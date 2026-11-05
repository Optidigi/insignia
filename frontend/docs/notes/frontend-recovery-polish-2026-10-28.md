# Frontend recovery follow-up

Owner correction: this delivery's gallery used the backend-integration buyer instead of the agreed customer frontend, and its pixel review missed misaligned unavailable-setup actions. The [subsequent correction](customer-ui-correction-2026-10-28.md) supersedes its customer-design conclusion and updates the gallery. Functional integration test receipts below remain historical evidence, not acceptance of that UI.

28 October 2026. Implements the three smaller recommendations from the [state completeness audit](state-completeness-audit-2026-10-28.md). The owner's subsequent instruction to challenge proposed fixes against real behavior and references remains the scope: improve recovery without inventing automatic repair, migration, support destinations or more pages.

## Decisions and behavior

### Storefront test context

Opening product setup now carries the validated product ID and the existing `#test-product` task anchor in its return path. Both the server and editor sanitize that return path. Only the exact Storefront route, one valid numeric product ID and the known anchor are permitted; unknown parameters, duplicate IDs, credentials, external destinations and other fragments are rejected. The breadcrumb keeps its Storefront setup label.

On return, focus moves to the test card. The native product picker preselects the original product even when browser storage is unavailable. Confirmation remains deliberate: a URL ID cannot provide a public product handle or prove publication. The card says Confirm product instead of repeating initial theme instructions. Cancellation preserves the requested product; confirmation still requires an authenticated publication check before the preview link appears. No automatic picker opening, publication or theme mutation is introduced.

The existing product-test helper owns the URL identity contract. The editor derives its return destination once and reuses it for navigation and recovery. No second navigation state store is added.

### Unsupported saved setup

An authenticated but uneditable saved setup displays a native warning banner with Reload setup and a return action. It explains that the saved setup has not changed and gives a plain support fallback. There is no fabricated support URL, reset, Create, Save or Publish action. Reload uses the existing fresh authenticated workflow and its skeleton. After completion, keyboard focus moves to the editable section, the still-unavailable recovery, or the read error, according to the observed result. Internal admin-build terminology is removed.

### Customized cart review status

The production buyer retains the server's cart-review observation in its reducer and renders a compact warning with the existing review/removal routes. It persists through editing, pending review and failure. A verified fresh cart observation or acknowledged cart apply/removal can resolve it; requesting a proposal alone does not claim the cart was repaired.

Saved-design review is an explicit intent resolved after a fresh cart and retained-design read. It cannot reintroduce earlier quantities or removed designs from a captured array. An in-progress new design continues through the complete-cart review, including both saved and new designs. Empty carts and nonempty carts with unrestorable designs remain distinct. The active wizard/review heading receives focus rather than the new warning heading. Duplicate error announcements are removed.

The separate polished buyer prototype does not receive a synthetic server repair status it cannot observe. These changes preserve the two buyer contracts.

## Reference application

- Shopify's [Resource Picker API](https://shopify.dev/docs/api/app-home/latest/apis/user-interface-and-interactions/resource-picker-api) specifies `selectionIds` as preselection and `undefined` as cancellation. This supports preserved identity plus explicit confirmation, rather than treating the return URL as native product context.
- Shopify's [Messages and feedback](https://shopify.dev/docs/apps/design/user-experience/alerts) places messages with the task, avoids technical terminology and requires useful recovery. The saved-setup warning uses the configured native Polaris 2.0 RC banner. The buyer warning uses the storefront's existing visual language.
- The [accepted Settings comparison](settings-ui-deferral-and-review-2026-10-27.md), its actual existing Storefront test card and `/tmp/insignia-recovery-before.png` supply the composition reference. The final change preserves its width, hierarchy, density and padding.
- Checklist Design's bundled Banner, Loading, Settings and Cart checklists supplied checks for relevant placement, readable actions, busy feedback, failure recovery and clear cart state. Shopify owns account security and billing; unrelated checklist items do not create new Settings requirements.
- The project-local Matt Pocock TDD guidance supplied public-interface regressions. Vercel's composition guidance supports keeping state authority separate from presentation; it does not justify a provider framework or new dependency for this small change.

## Independent review and verification

Two independent Sol reviewers inspected final source and actual desktop, 390px and 320px captures. They found a stale saved-group shortcut and warning-heading focus regression in the first cart implementation. Both were reproduced before correction. The focus correction also settles before paint, preventing a delayed focus effect from interrupting typing. The remove-design intent explicitly retains the existing pre-read cart-fingerprint guard. No remaining material finding is reported in the final scope.

- [Independent source, behavior and pixel review](frontend-recovery-sol-review-2026-10-28.md): 40 independently run checks passed, including current-cart quantities/removals and focus.
- [Independent composition and pixel review](frontend-recovery-sol-pixel-review-2026-10-28.md): inspected all affected captures and the explicit preview-host framing at three widths.

Final local checks:

| Check | Result |
| --- | --- |
| Complete production storefront suite | 69 passed, two explicit native/database skips, zero failures. `/tmp/insignia-cart-repair-storefront-final.log` |
| Fast frontend reducer/controller suite | 101 passed, zero failures. Includes overlapping buyer model checks; not added to the preceding total. `/tmp/insignia-recovery-models.log` |
| Public return-path and product-test helper checks | 17 passed. `/tmp/insignia-recovery-return-green.log` |
| Actual merchant return/recovery browser callers | Two passed; unsupported reload also verifies repeated unavailable state, loading and focus before an editable result. `/tmp/insignia-recovery-merchant-browser.log`, `/tmp/insignia-recovery-unsupported-green.log` |
| Adjacent Products breadcrumbs and guarded merchant navigation | Four passed. `/tmp/insignia-recovery-navigation.log` |
| Merchant build and isolated production buyer Vite build | Passed. `/tmp/insignia-recovery-web-build.log`, `/tmp/insignia-recovery-storefront-build.log`; generated theme assets were not copied into the working tree. |
| Strict compiler and maintained source coverage | All 36 effective projects pass, zero unchecked or untyped files. `/tmp/insignia-recovery-types-final.log`, `/tmp/insignia-recovery-source.log` |
| Formatting/lint and diff whitespace | Passed with existing nonblocking warnings. |
| Pinned Polaris 2.0 RC validation | Both changed merchant components pass. `/tmp/insignia-recovery-polaris-storefront-final.json`, `/tmp/insignia-recovery-polaris-editor-final.json` |

The extended browser fixture initially exposed a TypeScript control-flow narrowing problem when reusing its deferred read callback. A small assertion/release helper resolves it without casts or timing changes; the final strict and browser runs pass. The complete frontend command from the previous audit was not repeated: unchanged Orders/export and polished-buyer areas retain their earlier evidence, while these changed flows and their dependencies receive the scoped checks above. Counts overlap and are not summed.

Merchant captures: `/tmp/insignia-recovery-merchant-captures/`, including explicit preview-host `unsupported-host-{1440,390,320}.png`, task confirmation/return, verified product and loading. Buyer captures: `/tmp/insignia-cart-repair-captures/`, including unresolved, pending, failed and ready review states. The [local review gallery](http://127.0.0.1:62168/__preview/popup-review/) leads with only these changed states under Latest changes; all earlier states remain under All current states. Its images were copied into the existing persistent local artifact folder. The existing preview on port 62168 was restarted against the current merchant build; the temporary isolated capture host was stopped.

This is local implementation and synthetic browser verification. Native Shopify qualification, backend integration, provider writes and owner visual acceptance are separate. The preexisting static Polaris presentation findings are not silently closed by this work.
