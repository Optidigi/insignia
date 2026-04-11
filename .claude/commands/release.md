---
name: release
description: "Prepare and publish a new release. Runs the full test suite, updates versioning and changelog, builds artifacts, and tags."
arguments:
  bump:
    description: "Version bump type."
    enum:
      - patch
      - minor
      - major
    default: patch
---

Load the `release` skill before proceeding.

1. **Verify** — Spawn `tester` with `scripts/test-all.sh`. If anything fails,
   abort and report. Do not release on a red test suite.

2. **Version** — Bump the version according to `$bump` (semver). Update all
   relevant version files (package.json, pyproject.toml, Cargo.toml, etc.).

3. **Changelog** — Summarise new features, fixes, and breaking changes.
   Format: one bullet per item, linked to the relevant commit or PR.

4. **Build** — Run the production build. Verify no warnings escalated to errors.

5. **Review** — Spawn `reviewer` on the version bump and changelog diff only.

6. **Tag and push** — Tag the commit with the new version. Push tag and branch.

7. **Publish** — Follow the stack-specific publish step from the `release` skill
   (npm publish, Docker push, PyPI upload, etc.).

8. **Verify deployment** — Monitor logs for 5 minutes post-deploy. Report status.
