# Project skill scope and provenance

Project skills live under `.agents/skills` in the current checkout. Select that project path explicitly when the host also advertises a generic skill with the same name. A fresh session verifies its intended checkout and discovered skill paths; repository settings contain no machine-specific paths.

The [operating model](../../docs/delivery/operating-model.md) owns seam selection, review depth, model choice and actual resource permissions. Skill techniques adapt to that ownership; confirmation/refactoring/order recipes add no approval gate.

Matt Pocock's MIT-licensed source was inspected at commit c55ee46073ed923f86ce59a5eb3b6d895095d1b7; retained support files and [license](LICENSE.mattpocock) preserve provenance. Earlier project adaptations remain in Git history. No skill expands native permissions.

## Frontend handoff and verification

For UI packaging, integration planning or UI review, read `frontend/README.md` first. It identifies the selected placement/Methods components beside example adapters. Preserve those presentations when replacing adapters. Production `apps/*` and isolated `frontend/*` have different runtime roles; example request shapes do not prove backend compatibility.

For local execution, select `.node-version` and confirm it matches `package.json` before installing/building. CI, Docker digests and runtime qualification also pin Node; upgrades must reconcile all consumers. Build the workspace before tests that import compiled shared/localization packages. Install Chromium through both web and designer packages, which currently pin different Playwright versions.

For CI changes, retain the three protected jobs, their full-route checks and the narrow status-document classifier. The foundation job runs the root `check`, including `check:ui`; frontend-only changes must select full qualification. Use `scripts/ci/status-docs.test.mts` for route/guard regression. The frontend gate runs all four packages' tests and the embeddable library build. Review actual package scripts when changing coverage, including designer browser/localization checks.

The runtime job also runs the complete non-browser web/server test cohort against its migrated PostgreSQL18 service. This covers real Method propagation, configuration/reconciliation locks and purchase/customer-link composition; foundation's database-free web run alone cannot prove those branches. Keep the server/browser filename distinction explicit when adding a new test.

A passing local recovery test does not close a failing CI run or prove a timing cause. Record exact head, failed interaction, local reproduction result and remaining uncertainty. Demo/native deployment, backend integration and owner visual acceptance remain distinct outcomes.

Production merchant routes compose `SelectedProductEditor`/`SelectedMethods` with authenticated containers; examples keep explicit demo adapters. Preserve the shared reducers, visual markup and immutable publication/quote authority. Verify lost-response custody, current installation/authentication, explicit price provenance, dirty-edit preservation and publication correlation through the real built UI. Native Save Bar, secure upload, final-head CI and owner visual acceptance require their own evidence. Do not replace a failing retained behavior test with a selector/source assertion.

The selected PR223 UI includes native editor/table/chart controls under the owner preservation instruction. Boundary checks retain strict defaults and a finite exact-node/count manifest at `scripts/boundaries/selected-native-presentation.json`; they reject new/changed/stale native nodes and raw HTML. Do not expand this manifest to silence a failure. Trace any change to the selected source/authorized UI requirement and independently review it; defaults for new ordinary controls remain Polaris.

All customer flows use the new selected UI under the latest owner decision in specification §15, including retained production choices. Preserve option definitions/labels/accepted values during merchant projection, copying and owned-cart recovery; no legacy UI fallback. Legacy unsupported pricing stays explicit; it is never made free by omission.
