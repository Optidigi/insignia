> This review predates the newly observed CI and 39/40 stress failures. It is not a final disposition of those failures.

**SOURCE: no unresolved material finding. LIVE: BLOCKED_EVIDENCE.**

Reviewed existing PR #28 against:

- Head: `0e946ab8ad04b74d90618da0aaf6f43b4551b9d6`
- Tree: `404bb4f95a484b21708b3448a1ee8f3056e5a57e`
- Base/effective merge base: `28e69864ebb9796504861a541363880cc86a82f8`

Full M5-002 source, tests, scripts and relevant interacting paths preserve tenant/install fencing, transactional CAS and idempotent replay. Expected builds, provider observations and trusted artifact authority remain separate; production readiness requires `RELEASE_BOUND`. Source is unchanged from principal-accepted baseline `0b08c033d7a5609e2cfde219d5b76d4822d29723`.

Material **evidence** findings:

- **P1 — Exact restoration remains ambiguous.** [cleanup-receipt.json:13](https://github.com/Optidigi/insignia/blob/0e946ab8ad04b74d90618da0aaf6f43b4551b9d6/docs/delivery/evidence/m5-002r/cleanup-receipt.json#L13): identical app/shop/install returned **zero grants before and nine afterward**. CLI clean exited 0 and native no-preview/example.com observations support preview removal, but grant equality fails. The exact released-version resource was not independently reread afterward. Cause is unestablished; remote operations correctly stopped.
- **P1 — Live Function/artifact binding is unavailable.** [owned-function-observation.json:15](https://github.com/Optidigi/insignia/blob/0e946ab8ad04b74d90618da0aaf6f43b4551b9d6/docs/delivery/evidence/m5-002r/owned-function-observation.json#L15): both normalized identities are null. Handle display and build hashes cannot supply missing provider identity/query binding. No live dev attestation was constructed.
- **P1 — Required live recovery remains NOT_RUN.** [local-db-readback.json:10](https://github.com/Optidigi/insignia/blob/0e946ab8ad04b74d90618da0aaf6f43b4551b9d6/docs/delivery/evidence/m5-002r/local-db-readback.json#L10): draft remains v1; save, CAS conflict, committed-response loss and exact replay are all false. Create/open proves only that bounded flow.
- **P2 — Navigation/component/browser qualification remains incomplete.** [M5-002R-REPORT.md:38](https://github.com/Optidigi/insignia/blob/0e946ab8ad04b74d90618da0aaf6f43b4551b9d6/docs/delivery/M5-002R-REPORT.md#L38): cold direct deep link/reload were incomplete; actual Polaris upgrade and Konva construction were not independently inspected. Main-frame-only tooling leaves iframe console/DOM inaccessible; mobile and blocked-cookie qualification remain NOT_RUN.

The correction register consistently records **15 reads and six auth attempts/reservations**: two diagnostic exchanges plus four opaque CLI reservations. The stricter outer guard reserves and fsyncs before underlying fetch. The two additional legacy auth reservations were blocked before HTTP; the old 30/4/4 mirror is separate.

**Executed:** read-only Git/source inspection, Python integrity/accounting/hash checks, and an in-memory guard probe with mocked filesystem/transport. Both evidence manifests and the authority manifest match. Source comparison exited 0. `git diff --check` exited 2 for whitespace confined to retained evidence files.

**Inspected, not rerun:** six runtime/operator tests, 58 attestation tests, retained full-root/PG checks and 40-case stress evidence. These remain local evidence. Current-head CI was not independently verified.

End verification confirms unchanged refs and a clean worktree. No network, credential reads, writes or resource actions occurred. This is an independent reviewer disposition, not principal approval or gate adjudication.