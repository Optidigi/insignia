# Project skill scope and provenance

Project skills live under `.agents/skills` in the current checkout. Select that project path explicitly when the host also advertises a generic skill with the same name. A fresh session verifies its intended checkout and discovered skill paths; repository settings contain no machine-specific paths.

The [operating model](../../docs/delivery/operating-model.md) owns seam selection, review depth, model choice and actual resource permissions. Skill techniques adapt to that ownership; confirmation/refactoring/order recipes add no approval gate.

Matt Pocock's MIT-licensed source was inspected at commit c55ee46073ed923f86ce59a5eb3b6d895095d1b7; retained support files and [license](LICENSE.mattpocock) preserve provenance. Earlier project adaptations remain in Git history. No skill expands native permissions.

## Frontend handoff and verification

For UI packaging, integration planning or UI review, read `frontend/README.md` first. It identifies the selected placement/Methods components beside example adapters. Preserve those presentations when replacing adapters. Production `apps/*` and isolated `frontend/*` have different runtime roles; example request shapes do not prove backend compatibility.

For local execution, select `.node-version` and confirm it matches `package.json` before installing/building. CI, Docker digests and runtime qualification also pin Node; upgrades must reconcile all consumers. Build the workspace before tests that import compiled shared/localization packages. Install Chromium through both web and designer packages, which currently pin different Playwright versions.

For CI changes, retain the three protected jobs, their full-route checks and the narrow status-document classifier. The foundation job runs the root `check`, including `check:ui`; frontend-only changes must select full qualification. Use `scripts/ci/status-docs.test.mts` for route/guard regression. The frontend gate runs all four packages' tests and the embeddable library build. Review actual package scripts when changing coverage, including designer browser/localization checks.

A passing local recovery test does not close a failing CI run or prove a timing cause. Record exact head, failed interaction, local reproduction result and remaining uncertainty. Demo/native deployment, backend integration and owner visual acceptance remain distinct outcomes.
