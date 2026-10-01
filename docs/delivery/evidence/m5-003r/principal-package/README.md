# Insignia M5-003R principal handoff

**Next action: correct existing PR #29, then return for principal rereview.**

This package contains an external CHANGES_REQUESTED verdict, not a merge approval or a successor milestone authorization. The principal found and independently characterized two defects in the reported final source: availability freshness is reset at response completion, and a valid UNLISTED status is treated as malformed.

Read `PR-029-principal-review.md` for the findings and exact evidence scope. Execute `M5-003R-AVAILABILITY-CONTRACT-CORRECTION.md` only after the owner sends `OWNER-LAUNCH.txt` with this package. The owner launch authorizes only that local correction and existing-PR updates.

The `evidence/` source snapshots are byte-verified copies of the reviewed implementation, **not corrected code**. Do not copy them over the working implementation. The diagnostic probe characterizes the old source; permanent regressions belong at the actual public seams under the pinned project runtime.

`verification.json` records the verified checkpoint and distinguishes direct observations from reported evidence. `MANIFEST.sha256` covers the package files other than itself. No file in this package has been committed or posted to GitHub by the principal.

## Suggested skills

Reuse `.agents/skills/diagnosing-bugs`, `tdd`, `code-review`, `writing-for-agents` and `handoff`, including their applicable references and the project's recorded upstream pins. Project authority and the correction brief govern execution. There is no new product interview or `grilling` session to conduct for these adapter corrections.
