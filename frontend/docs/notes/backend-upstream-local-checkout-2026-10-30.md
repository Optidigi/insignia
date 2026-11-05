# Local backend reference checkout

30 October 2026. Refreshed `origin` with `git fetch origin --prune`.

The canonical remote is `https://github.com/Optidigi/insignia.git`; its default branch is `main`. The fetched `origin/main` is `54c222ba8e4481b4c50be4522f9ab7686fb49d67`, dated 19 October 2026, the merge of PR 222. No remote branch inspected has a later commit date. The current frontend branch `codex/ui-redesign` is ten commits ahead and zero behind that main branch. Its backend already includes the latest canonical upstream source. Pulling or resetting it to main would remove later UI/order work rather than obtain a newer backend.

Created a clean, detached Git worktree at:

`/Users/pc/Development/Insignia/insignia-backend-upstream`

It points exactly at the fetched `origin/main`. It is a source reference for backend development; no dependency installation, server startup, database migration or deployment was performed in that checkout. Detached HEAD avoids moving an existing branch. It shares Git history with the active repository, but has an independent working directory.

The active frontend remains in `/Users/pc/Development/Insignia/insignia` and the selected customer modal remains in `/Users/pc/Development/Insignia/designer-prototype`. Existing dirty changes were preserved. Before implementation, a source-only snapshot was saved under `/Users/pc/Development/Insignia/.artifacts/frontend-hardening-2026-10-30/frontend-source-before.tar.gz`, with a SHA-256 inventory alongside it. This includes the selected customer source and merchant source/preview support, excluding credentials and dependency folders.

For a later upstream update: fetch again, inspect the new canonical commit and update this clean reference worktree deliberately. Do not merge remote source into the dirty UI checkout or overwrite the sibling customer folder as a shortcut. The backend developer should consume the frontend's documented runtime adapters and contracts rather than replace the chosen modal with `apps/storefront`'s older integration UI.
