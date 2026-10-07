**CHANGES_REQUESTED — independent PRE-VERSION spec/correctness review.**

Reviewed head `2b8473a52dce01564901eae3b075a38adf62fd6b` against verified effective merge base `703cfb21a4262675b088cd06289fe08a421ecdd8`.

1. **[P1] The wrapper does not enforce a complete frozen artifact/evidence inventory.** [create-unreleased-version.py:53](/home/serveradmin/insignia-m5-019-worktree/deployment/m5-019/create-unreleased-version.py:53)  
   Requirement: “Gate must bind full accepted inventory/current candidate files/reports/settings/CI/host receipts”; the brief requires qualification sufficient “to know the version will contain the reviewed artifacts.”  
   Counterexample: package the accepted candidate, replace its Wasm or extension UID, and omit that file from `gate["files"]`. An empty file list passes. The candidate app TOML still matches, and clean Git status does not cover the external candidate. Dispatch uploads substituted artifacts with `--no-build`. Review reports and host receipts likewise have no mandatory binding; review verdicts are supplied directly by the gate.  
   **Correction:** require complete manifest membership, anchored to the accepted inventory and committed bindings, covering candidate contents, required reports/settings, launch anchors and host receipts. Immediately before reservation, verify hashes and extension identities, reject missing/unexpected files and escaping paths.

2. **[P1] Ten CI rows do not establish ten applicable workflow successes.** [create-unreleased-version.py:51](/home/serveradmin/insignia-m5-019-worktree/deployment/m5-019/create-unreleased-version.py:51)  
   Requirement: “all ten must finish SUCCESS before dispatch.”  
   Counterexample: ten copies of one completed successful current-head run satisfy both assertions while another applicable workflow remains running or fails. Neither distinct workflow identities nor complete coverage are checked.  
   **Correction:** require exactly the ten applicable workflow identities, each represented once by a completed successful current-head run, bound to the intended repository/event and observed run identifiers. TEN is the correct current gate; M0-007’s path filters do not apply. Historical PR49’s eleven checks cannot substitute for this gate.

3. **[P1] Python optimization disables the readiness checks.** [create-unreleased-version.py:36](/home/serveradmin/insignia-m5-019-worktree/deployment/m5-019/create-unreleased-version.py:36)  
   Requirement: “Only after all readiness gates pass, create exactly one Shopify app version with **no release**.”  
   Counterexample: invoking the wrapper with `python3 -O`, or inherited `PYTHONOPTIMIZE=1`, removes every `assert`, including frozen status, head/clean-tree checks, review/CI checks, hashes and runtime constraints. With structurally readable inputs, execution reaches reservation and dispatch despite failed gates. The child’s environment allowlist cannot restore checks already removed in the parent.  
   **Correction:** replace authorization assertions with unconditional validation that raises on failure, or unconditionally reject optimized execution before processing the gate.

Inspection covered the diff, all changed files, required authority documents, sanitized evidence and original predeployment reviews/responses; complete relevant deployed admin/editor/routes, authentication/token-exchange, production runtime/application, tenant/config/publication/activation/database seams and migrations; packaging, deployment configuration and creation operator. Personal read-only hash inspection found no mismatch across the accepted **396 source + 225 build hashes**. No tests, builds, mutations, network/provider operations or delegation were performed.

The evidence supports `HOST_WEB_READINESS_PASS`; original failures, rollback timeout and unresolved LXD administrative cleanup remain recorded. Empty redirects match token exchange. The two UUIDs are correctly described as proposed local identities. Supported installation evidence establishes presence, without claiming complete inventory.

The durable exclusive reservation and fixed `--no-build --no-release` dispatch preserve one-attempt/no-retry behavior. Creation/readback receipts are intentionally pending and are **not** findings. Current-head CI success was not independently observed here. Dispatch remains blocked by the findings above and requires all ten applicable successes plus fresh review of the corrected head. This is not principal approval.