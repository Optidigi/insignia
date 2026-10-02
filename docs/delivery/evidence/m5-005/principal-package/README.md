# PR #30 approval and M5-005 handoff

Read `PR-030-principal-review.md` first. It approves only the exact M5-004 operator/stopped-evidence candidate, not live availability qualification. Its reference binding is authoritative for this package.

`OWNER-LAUNCH.txt` is the owner's delegation text. **Creating or receiving this package alone does not delegate a merge or credential/provider access.** When the owner forwards that launch, verify and normally merge the exact PR #30 candidate, then execute only `M5-005-SCOPE-PROVENANCE-DIAGNOSTIC.md` on a new branch. Leave the reviewed head unchanged; import the approval after the verified merge.

M5-005 performs a bounded read-only scope comparison. It does not repair access or resume M5-004. Empty scopes are diagnostic input, not permission for mutation. Existing registers, failed evidence and historical grant observations remain intact.

`verification.json` distinguishes direct GitHub/source review, reported runtime evidence and unperformed operations. No new executable probe or test run by the principal is claimed. Existing source/evidence should be read in the repository, not copied from archived snapshots onto runtime files.

Validate `MANIFEST.sha256` before use. Its hashes cover all other package files; the ZIP hash is supplied outside the archive.
